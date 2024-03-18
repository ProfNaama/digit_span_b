const csv = require('csv-parser')
const fs = require('fs');
const path = require('path');
const config = require('./config.js');
const { Pool } = require('pg');

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

async function listAvatars() {
    const avatars = await fs.promises.readdir('static/images/avatars/');
    return avatars.map(f => path.join('static/images/avatars', f));
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

const hiddenPromptPrefix = "You have the following set of human characharistics: ";
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
    if (!req.session.initialTask) {
        req.session.initialTask = getFirstCsvRecordValue(getTreatmentGroupCsvRecords(req), "task_description");
    }
    return req.session.initialTask;
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

function sessionToJsonObject(req) {   
    const sessionJson = {
        "uid": req.session.uid,
        "treatmentGroupId": req.session.treatmentGroupId,
        "initialTask": req.session.initialTask,
        "preference": req.session.preference,
        "systemRoleHiddenContent": req.session.systemRoleHiddenContent,
        "conversationContext": req.session.conversationContext,
        "userConfigFilter": req.session.userConfigFilter,
        "quessionsAnswers": req.session.quessionsAnswers
    }
    return sessionJson;
}

function saveSessionResults(req) {
    let sessionText = JSON.stringify(sessionToJsonObject(req));
    if (config.encodeBase64){
        sessionText = Buffer.from(sessionText).toString('base64');
    }
    const sessionResultObj = {time: new Date(), uid:req.session.uid, userid:req.session.userid, data: sessionText };
    if (config.resultsFile){
        fs.appendFileSync(config.resultsFile, JSON.stringify(sessionResultObj) + "\n", { flush: true } );
    }
    if (config.pgUser && config.pgHost && config.pgDatabase && config.pgTable && config.pgPassword) {
        // use pg to insert results to the database table
        const pool = new Pool({
            user: config.pgUser,
            host: config.pgHost,
            database: config.pgDatabase,
            password: config.pgPassword,
            port: config.pgPort,
            ssl: { rejectUnauthorized: false },
        }); 
        
        const query = {
            text: 'INSERT INTO results (uuid, userid, result) VALUES ($1, $2, $3)',
            values: [sessionResultObj.uid, sessionResultObj.userid, sessionResultObj]
        }
    
        pool.query(query, (error) => {
            if (error) {
                console.log("Error: " + error);
            }
            pool.end();
        });
    }
    return sessionResultObj;

    // base64 back to object
    //const base64 = JSON.parse(JSON.stringify(Buffer.from(sessionText, 'base64').toString('utf-8')));
    //console.log("base64 to json: " + base64);
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
    getAndResetInteractionTime,
    saveSessionResults,
    listAvatars
}