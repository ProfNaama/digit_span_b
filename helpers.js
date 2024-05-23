const csv = require('csv-parser')
const fs = require('fs');
const path = require('path');
const config = require('./config.js');
const { Pool } = require('pg');

const csvBasePath = "experiment_configuration/";
const csvDB = {};

let treatmentFroupConfigRecords;
let userQuestionnaireRecords;

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
                .on('data', (data) => { 
                    if (Object.keys(data).length > 0) {
                        records.push(data)
                    }
                })
                .on('end', () => {
                    csvDB[fileName] = records;
                    resolve()
                });
            });
        })
    );
    treatmentFroupConfigRecords = getCsvRecords("treatment_groups_config.csv");
    userQuestionnaireRecords = getCsvRecords("questions_bank.csv");
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
    return treatmentFroupConfigRecords;
}

// notice that in case we want to reproduce random numbers, we could add the flag --random_seed=42 (or whatever number) to the node command.
function getRandomInt(min, max) {
    const minCeiled = Math.ceil(min);
    const maxFloored = Math.floor(max);
    return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled); // The maximum is exclusive and the minimum is inclusive
}


function getRenderingParamsForPage(page) {
    let params = {
        title: "ChatLab",
        header_message: getFirstCsvRecordValue(getCsvRecords("experiment_desc.csv").filter(raw => raw["page"] === page), "header"), 
        body_message: getFirstCsvRecordValue(getCsvRecords("experiment_desc.csv").filter(raw => raw["page"] === page), "body1"), 
        body2_message: getFirstCsvRecordValue(getCsvRecords("experiment_desc.csv").filter(raw => raw["page"] === page), "body2"), 
    };
    
    return params;
}

function getUserTestQuestions(req) {
    const treatmentGroupQuestions = getTreatmentGroupCsvRecords(req)[0]["user_questions"].split(";").map(q => q.trim());
    let questions = [];

    treatmentGroupQuestions.forEach(q => { 
        userQuestionnaireRecords.filter(record => record["question_name"] === q).map((record) => { 
            const name = record["question_name"];
            const label = record["question_text"].trim() ? record["question_text"].trim() : null
            const is_text = record["is_text"] == "1" ? true : false;
            const is_likert = record["is_likert"] == "1" ? true : false ;
            const is_multi_choise = record["is_multi_choice"] == "1" ? true : false ;
            const is_insturctions = record["is_insturctions"] == "1" ? true : false ;

            const multi_choise_options = record["multi_choice_options"].split("|").map(o => o.trim());
            questions.push({"name": name, "label": label, "is_text": is_text, "is_likert": is_likert, "likert_scale": multi_choise_options, "is_multi_choice": is_multi_choise, "is_insturctions": is_insturctions, "choices": multi_choise_options});
        });
    });
    return questions;
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
        "sessionStart": req.session.sessionStartTime,
        "userQuestionnaireEnded": req.session.user_questionnaire_ended,
        "prolificUid": req.session.prolificUid,
        "code": req.session.code,
        "conversationContext": req.session.conversationContext,
        "quessionsAnswers": req.session.quessionsAnswers,
        "completionCode": req.session.completionCode
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
    
    if (config.connectionString) {
        // use pg to insert results to the database table
        const pool = new Pool({
            connectionString: config.connectionString,
            ssl: { rejectUnauthorized: false },
        }); 
        
        const query = {
            text: 'INSERT INTO mem_test_results (uuid, userid, result) VALUES ($1, $2, $3)',
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

async function isCodeValid(code) {
    if (code) {
        if (config.reusableCode && (code === config.reusableCode)) {
            return true;
        }

        if (config.connectionString) {
            const pool = new Pool({
                connectionString: config.connectionString,
                ssl: { rejectUnauthorized: false },
            }); 
            
            const query = {
                text: 'SELECT completed FROM mem_test_codes WHERE code = $1',
                values: [code]
            }
        
            const result = await new Promise((resolve, reject) => {
                pool.query(query, (error, result) => {
                    pool.end();
                    if (error) {
                        console.log("Error: " + error);
                        resolve(false);
                    }
                    resolve(result);
                });
            });
            return result && result.rows && result.rows[0] && !result.rows[0].completed;
        }
    }
    return false;
}

async function setCodeCompleted(code, obj) {
    if (config.reusableCode && (code === config.reusableCode)) {
        return true;
    }

    if (config.connectionString) {
        const pool = new Pool({
            connectionString: config.connectionString,
            ssl: { rejectUnauthorized: false },
        }); 
        
        const query = {
            text: 'UPDATE mem_test_codes SET completed = $2 WHERE code = $1',
            values: [code, obj]
        }
    
        const result = await new Promise((resolve, reject) => {
            pool.query(query, (error, result) => {
                pool.end();
                if (error) {
                    console.log("Error: " + error);
                    resolve(false);
                }
                resolve(result);
            });
        });
        return result;
    }
}

module.exports = {
    waitForSystemInitializiation,
    getCsvRecords,
    getFirstCsvRecordValue,
    getRandomInt,
    getAndResetInteractionTime,
    saveSessionResults,
    isCodeValid,
    setCodeCompleted,
    getRenderingParamsForPage,
    getUserTestQuestions
}