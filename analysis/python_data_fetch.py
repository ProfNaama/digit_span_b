import json
import base64
import re
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import datetime
import difflib

postgresql_filename = "analysis/select_results_81.json"
results_filename = 'analysis/json_results_81.json'

with open(postgresql_filename, 'r') as inf:
    data = json.load(inf)
for d in data:
    d['result']['json'] = json.loads(base64.b64decode(d['result']['data']))
    d['result']['data'] = ""
    #d['result']['json']['completed'] = d['completed']
with open(results_filename, 'w') as outf:
    json.dump(data, outf, indent=4)
    #outf.write(json.dumps(data))

with open(results_filename, 'r') as jsonF:
    data = json.load(jsonF)


data = list(filter(lambda x: x['result']['json']['code'] != "123123123", data))
len(data)


def getIntFromTextHelper(text, indices=[0]):
    str_list = re.findall(r'\d+', text)
    int_list = [int(n) for n in str_list]
    return [int_list[i] if i < len(int_list) else None for i in indices]

def getQuestionAnswer(d, question):
    if question not in d['quessionsAnswers']:
        raise Exception("{} not in quessionsAnswers".format(question))
    return d['quessionsAnswers'][question]


def getUid(d):
    return d['uid']
    
def getMemTestQuestionAnswerTuple(d, idx):
    q = "".join([str(n) for n in d['conversationContext'][idx]["random_numbers"]]).lower()
    a = d['conversationContext'][idx]["user_response"].lower()
    for n, numStr in enumerate(["zero", "one", "tow", "three", "four", "five", "six", "seven", "eight", "nine"]):
        a = a.replace(numStr, str(n))
    a = a.replace(" ", "")
    a = a.replace(",", "")
    a = a.replace(";", "")
    
    return q, a 

def getSimilarityScore(d, idx):
    q, a = getMemTestQuestionAnswerTuple(d, idx)
    return difflib.SequenceMatcher(None, q, a).ratio()

questionsList = [
    "Fink_Q_1",
    "Fink_Q_2",
    "Fink_Q_3",
    "Fink_Q_4",
    "Fink_Q_5",
    "Attention_Q_1",
    "Device_Q",
    "Calstera_Q_1",
    "Calstera_Q_2",
    "Calstera_Q_3",
    "Calstera_Q_4",
    "Attention_Q_2",
    "Calstera_Q_5",
    "Calstera_Q_6",
    "Calstera_Q_7",
    "Calstera_Q_8",
    "Calstera_Q_9",
    "Calstera_Q_10",
    "Calstera_Q_11",
    "Calstera_Q_12",
    "Calstera_Q_13",
    "Calstera_Q_14",
    "Calstera_Q_15",
    "Calstera_Q_16",
    "Calstera_Q_17",
    "q_comments"
]

columnsToFetcherDict = {
    "uid":getUid,
}

for idx in range(5):
    columnsToFetcherDict["memQ_" + str(idx)] = lambda d,idx=idx: getMemTestQuestionAnswerTuple(d, idx)[0]
    columnsToFetcherDict["memA_" + str(idx)] = lambda d,idx=idx: getMemTestQuestionAnswerTuple(d, idx)[1]
    columnsToFetcherDict["similarity_score_" + str(idx)] = lambda d,idx=idx: getSimilarityScore(d, idx)

for q in questionsList:
    columnsToFetcherDict[q] = lambda d, q=q: getQuestionAnswer(d, q)

def missingDataWrapper(handler, d):
    try :
        return handler(d)
    except Exception as e:
        return np.nan

def buildDF(data):
    jsonData = [d['result']['json'] for d in data]
    #jsonData = list(filter(lambda d: d['treatmentGroupId'] in [5, 6], jsonData))[:1]
    dataDict = {
        c:[missingDataWrapper(handler, d) for d in jsonData] for c,handler in columnsToFetcherDict.items()
    }
    return pd.DataFrame(dataDict)

jsonData = [d['result']['json'] for d in data]
    #jsonData = list(filter(lambda d: d['treatmentGroupId'] in [5, 6], jsonData))[:1]
dataDict = {
    c:[missingDataWrapper(handler, d) for d in jsonData] for c,handler in columnsToFetcherDict.items()
}

results_filename = 'analysis/42_measures_reslts_76.csv'

df = buildDF(data)
df.to_csv(results_filename, index=False)

