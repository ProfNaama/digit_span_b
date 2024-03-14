const csv = require('csv-parser')
const fs = require('fs');

const experimentFlowCsvFileName = "experiment_config.csv";
const chatgptMeasuresCsvFileName = "chatgpt_measures.csv";
const experimentFlowRecords = [];
const measuresRecords = [];
let treatmentGroups = [];

fs.createReadStream(experimentFlowCsvFileName)
    .pipe(csv())
    .on('data', (data) => experimentFlowRecords.push(data))
    .on('end', () => {
        treatmentGroups = Array.from(new Set(experimentFlowRecords.map(r => parseInt(r["treatment_group"]))));
    }
);

fs.createReadStream(chatgptMeasuresCsvFileName)
    .pipe(csv())
    .on('data', (data) => measuresRecords.push(data)
);

function getMeasuresRecords() {
    return measuresRecords;
}

function getTreatmentGroupId(uid) { 
    return treatmentGroups[(uid % treatmentGroups.length)];
}

function getFirstRecordValue(req, property_name) { 
    const treatmentGroupRecords =  experimentFlowRecords.filter(r => parseInt(r["treatment_group"]) === req.session.treatmentGroupId);
    return treatmentGroupRecords[0][property_name];
}

// notice that in case we want to reproduce random numbers, we could add the flag --random_seed=42 (or whatever number) to the node command.
function getRandomInt(min, max) {
    const minCeiled = Math.ceil(min);
    const maxFloored = Math.floor(max);
    return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled); // The maximum is exclusive and the minimum is inclusive
}

function getSelectedRecords(req) {
    // filter the records according to the user's treatment group and user config filter
    const treatmentGroupRecords =  experimentFlowRecords.filter(r => parseInt(r["treatment_group"]) === req.session.treatmentGroupId);
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

    const randomWords = [
        "Spaghetti Bolognese",
        "Chicken Tikka Masala",
        "Hamburger",
        "Caesar Salad",
        "Sushi",
        "Pizza",
        "Tacos",
        "Fried Rice",
        "Lasagna ",
        "Beef Stroganoff",
        "Chocolate Cake",
        "Apple Pie",
        "Ice Cream",
        "Cheesecake",
        "Brownies",
        "Toyota",
        "Mercedes",
        "BMW",
        "Ford",
        "Honda",
        "Nissan",
        "Chevrolet",
        "NewYork",
        "Los Angeles",
        "Chicago",
        "Houston",
        "Miami",
        "San Francisco",
        "Las Vegas",
        "Seattle",
    ]
    return  taskDescription = getFirstRecordValue(req, "task_description") + 
        ". Find such a task that resembles to the word " + randomWords[getRandomInt(0, randomWords.length)];   
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
    getMeasuresRecords,
    getTreatmentGroupId,
    getFirstRecordValue,
    getRandomInt,
    getSelectedRecords,
    createFullConversationPrompt,
    filterUserConfigProperties,
    groupRecordsByProperty,
    setSelectedHiddenPromptToSession,
    logHiddenPrompts,
    getInteractionTime: getAndResetInteractionTime
}