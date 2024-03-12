const csv = require('csv-parser')
const fs = require('fs');

const csvFileName = "experiment_config.csv";
const csvRecords = [];
let treatmentGroups = [];

fs.createReadStream(csvFileName)
    .pipe(csv())
    .on('data', (data) => csvRecords.push(data))
    .on('end', () => {
        treatmentGroups = Array.from(new Set(csvRecords.map(r => parseInt(r["treatment_group"]))));
    }
);

function getTreatmentGroupId(uid) { 
    return treatmentGroups[(uid % treatmentGroups.length)];
}

function getRandomInt(min, max) {
    const minCeiled = Math.ceil(min);
    const maxFloored = Math.floor(max);
    return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled); // The maximum is exclusive and the minimum is inclusive
}

function getSelectedRecords(req) {
    // filter the records according to the user's treatment group and user config filter
    const treatmentGroupRecords =  csvRecords.filter(r => parseInt(r["treatment_group"]) === req.session.treatmentGroupId);
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

const defaultInitialTask = "You are a virtual assistant working with a human adult person. Your task is to come up with a simple fun riddle challange for the person to try and solve.";
function getInitialTaskContent(req) {
    if (req.session.initialTask) {
        return req.session.initialTask;
    }
    return defaultInitialTask;
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
    getTreatmentGroupId,
    getRandomInt,
    getSelectedRecords,
    createFullConversationPrompt,
    filterUserConfigProperties,
    groupRecordsByProperty,
    setSelectedHiddenPromptToSession,
    logHiddenPrompts,
    getInteractionTime: getAndResetInteractionTime
}