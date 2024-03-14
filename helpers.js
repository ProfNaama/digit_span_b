const csv = require('csv-parser')
const fs = require('fs');
const path = require('path');

const csvBasePath = "experiment_configuration/";
const csvDB = {};

let treatmentFroupConfigRecords;
let measuresRecords;
let userQuestionnaireRecords;
let experimentDescRecords;
let treatmentGroups;

// read the csv files and store them in the csvDB
// we use async createReadStream to parse records
// se we wrap it in promise and wait for all of them to finish
async function readAllCsvFiles() {
    await Promise.all(
        fs.readdirSync(csvBasePath).filter(fileName => fileName.endsWith(".csv")).map(fileName => {
            let records = [];
            return new Promise((resolve, reject) => {
                fs.createReadStream(path.join(csvBasePath, fileName))
                .pipe(csv())
                .on('data', (data) => records.push(data))
                .on('end', () => {
                    csvDB[fileName] = records;
                    resolve()
                });
            });
        })
    );
    treatmentFroupConfigRecords = getCsvRecords("treatment_groups_config.csv");
    measuresRecords = getCsvRecords("chatgpt_measures.csv");
    userQuestionnaireRecords = getCsvRecords("user_questionnaire.csv");
    experimentDescRecords = getCsvRecords("experiment_desc.csv");
    treatmentGroups = Array.from(new Set(treatmentFroupConfigRecords.map(r => parseInt(r["treatment_group"]))));
}

let initializationPromise = new Promise((resolve, reject) => {
    readAllCsvFiles().then(() => {
        resolve();
    });
});

async function waitForSystemInitializiation() {   
    await initializationPromise;
}

function getCsvRecords(csv_file) {
    return csvDB[csv_file];
}

function getFirstCsvRecordValue(csvRecords, property_name) { 
    return csvRecords[0][property_name];
}

function getTreatmentGroupCsvRecords(req) {
    return treatmentFroupConfigRecords.filter(r => parseInt(r["treatment_group"]) === req.session.treatmentGroupId);
}

function getMeasuresRecords() {
    return measuresRecords;
}

function getUserQuestionnaireRecords() {
    return userQuestionnaireRecords;
}

function getTreatmentGroupId(uid) { 
    return treatmentGroups[(uid % treatmentGroups.length)];
}

// notice that in case we want to reproduce random numbers, we could add the flag --random_seed=42 (or whatever number) to the node command.
function getRandomInt(min, max) {
    const minCeiled = Math.ceil(min);
    const maxFloored = Math.floor(max);
    return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled); // The maximum is exclusive and the minimum is inclusive
}

function getSelectedRecords(req) {
    // filter the records according to the user's treatment group and user config filter
    const treatmentGroupRecords =  treatmentFroupConfigRecords.filter(r => parseInt(r["treatment_group"]) === req.session.treatmentGroupId);
    let filteredRecords = [];
    for (const record of treatmentGroupRecords) {
        let match = true;
        for (const [userK, userV] of Object.entries(req.session.userConfigFilter)) {
            if (record["property_name"] == [userK]) {
                match = false;
                if (record["property_value"] == userV) {
                    match = true;
                    break;
                }
            }
        }
        if (match) {
            filteredRecords.push(record);
        }   
    }
    return filteredRecords;
}

function getSelectedPrompts(req) {
    return getSelectedRecords(req).map(r => r["hidden_prompt"]);
}

const hiddenPromptPrefix = "You are a virtual assistant. You are interacting with a human person. You have the following set of human characharistics: ";
function mergeHiddenPrompts(prompts) {    
    return hiddenPromptPrefix + prompts.join("\n");
}

function logHiddenPrompts(req) {
    console.log("uid: " + req.session.uid + 
        ", treatment group: " + req.session.treatmentGroupId + 
        ", hidden system role is set to : " + req.session.systemRoleHiddenContent +
        ", initial task: " + getInitialTaskContent(req)
    );
}

function setSelectedHiddenPromptToSession(req) {
    const hiddenSystemRoleContent = mergeHiddenPrompts(getSelectedPrompts(req));
    req.session.systemRoleHiddenContent = hiddenSystemRoleContent;
    req.session.save();
}

function getInitialTaskContent(req) {
    if (req.session.initialTask) {
        return req.session.initialTask;
    }
    return  taskDescription = getFirstCsvRecordValue(getTreatmentGroupCsvRecords(req), "task_description");
}

function createFullConversationPrompt(req) {
    const initialTaskContent = getInitialTaskContent(req);
    let conversationSystemRole = {"role": "system", "content": req.session.systemRoleHiddenContent + "\n" + initialTaskContent}; 
    const conversation = req.session.conversationContext.map(c => ({role: c.role, content: c.content}));
    const messageWithContext = [conversationSystemRole].concat(conversation);

    return messageWithContext;
}

function groupRecordsByProperty(records) {
    let recordsByProperty = {};
    for (const record of records) {
        if (!recordsByProperty[record["property_name"]]) {
            recordsByProperty[record["property_name"]] = [];
        }
        recordsByProperty[record["property_name"]].push(record["property_value"]);
    }
    return recordsByProperty;}

function filterUserConfigProperties(recordsByProperty) {
    // filter those properties that have more than one value, so the user can select a preference
    let userConfigProperties = {};
    Object.keys(recordsByProperty).forEach(k => {
        if (recordsByProperty[k].length > 1) {
            userConfigProperties[k] = recordsByProperty[k];
        }
    });
    return userConfigProperties;
}

function getAndResetInteractionTime(req) {
    let currentTime = Date.now()
    let prevInteractionTime = currentTime;
    if (req.session.lastInteractionTime) {
        prevInteractionTime = req.session.lastInteractionTime;
    }
    req.session.lastInteractionTime = currentTime;
    // return milliseconds passed since the last interaction
    return Math.floor((currentTime - prevInteractionTime));
}

module.exports = {
    waitForSystemInitializiation,
    getMeasuresRecords,
    getUserQuestionnaireRecords,
    getTreatmentGroupId,
    getCsvRecords,
    getFirstCsvRecordValue,
    getRandomInt,
    getSelectedRecords,
    createFullConversationPrompt,
    filterUserConfigProperties,
    groupRecordsByProperty,
    setSelectedHiddenPromptToSession,
    logHiddenPrompts,
    getInteractionTime: getAndResetInteractionTime
}