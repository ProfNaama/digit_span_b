const express = require('express');
const bodyParser = require('body-parser');
const OpenAIApi = require("openai");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const app = express();
const helpers = require("./helpers.js");
const config = require('./config.js');

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }))
app.set('view engine', 'pug');
app.use('/static', express.static('static'));


// Initialization
app.use(cookieParser());
app.use(session({
    secret: "SSsseess",
    saveUninitialized: true,
    resave: true
}));

const maxUID = 100000;

const openai = new OpenAIApi({
    apiKey: config.apiKey
});

// Middleware to initilaize the system
async function verifySystemInitialized(req, res, next) {
    await helpers.waitForSystemInitializiation(); 
    next();
};

// Middlewares to be executed for every request to the app, making sure the session is initialized with uid, treatment group id, etc.
function verifySession(req, res, next) {
    if (!req.session.uid) {
        let uid = parseInt(req.query["uid"]) || helpers.getRandomInt(0, maxUID);

        req.session.uid = uid;
        req.session.treatmentGroupId = helpers.getTreatmentGroupId(uid);
        req.session.initialTask = ""
        req.session.systemRoleHiddenContent = "";
        req.session.conversationContext = [];
        req.session.preferences = null;
        req.session.userConfigFilter = {};
        req.session.lastInteractionTime = null;
        req.session.quessionsAnswers = {};
        req.session.global_measures = {}
        req.session.code = null;
        req.session.completionCode = null;
        req.session.consent = false;
        req.session.finished = false;
        req.session.save();
        console.log("new session. uid: " + req.session.uid + ", treatment group: " + req.session.treatmentGroupId);
    }
    next();
}

// Middlewares to be executed for every request to the app, making sure the session has not already finished.
function verifySessionEnded(req, res, next) {
    if (req.session.finished) {
        let renderParams = helpers.getRenderingParamsForPage("session_ended");
        if (req.session.completionCode) {
            renderParams["completion_code"] = req.session.completionCode;
        }
        res.render('./session_ended', renderParams);
        return;
    }
    next();
};

// Middlewares to be executed for every request to the app, making sure the session is initialized with code.
async function verifySessionCode(req, res, next) {
    if (!req.session.code) {
        if (req.path === "/welcome_code" && req.method === "POST") {
            const isCodeValid = await helpers.isCodeValid(req.body["code"]);
            if (isCodeValid) {
                req.session.code = req.body["code"];
                req.session.save();
                res.redirect(302, "/");
                return;
            }
        }
        res.render('./welcome_code', helpers.getRenderingParamsForPage("welcome_code"));
        return;
    }
    next();
};

// Middlewares to be executed for every request to the app, making sure the session is initialized with user consent.
function verifyUserConsent(req, res, next) {
    if (!req.session.consent) {
        if (req.path === "/consent" && req.method === "POST") {
            let declined = false;
            Object.keys(req.body).forEach(key => {
                if (key.startsWith("consent.")) {
                    if (req.body[key] !== "YES") {
                        declined = true;
                    }
                }
            });
            if (declined) {
                let renderParams = helpers.getRenderingParamsForPage("session_ended");
                renderParams["body_message"] = "You opted not to consent. Thank You.";
                res.render('./session_ended', renderParams);
                req.session.destroy();
                return;
            }

            req.session.consent = true;
            req.session.save();
            res.redirect(302, "/");
            return;            
        }
        
        res.render('./consent', helpers.getRenderingParamsForPage("consent"));
        return;
    }
    next();
};

// Middlewares to be executed for every request to the app, making sure the session is initialized with user preferences.
async function verifyUserPreferences(req, res, next) {
    if (!req.session.preferences) {
        if (req.path === "/user_preferences" && req.method === "POST") {
            const avatars = await helpers.listAvatars();
            const preferences_default = {
                "user_name": "user", 
                "user_avatar" : avatars[avatars.length-2]
            };

            req.session.preferences = preferences_default;
            Object.keys(req.body).forEach(key => {
                if (key.startsWith("preferences.")) {
                    req.session.preferences[key.replace("preferences.", "")] = req.body[key];
                }
                else if (key.startsWith("user_config")) {
                    req.session.userConfigFilter[key.replace("user_config.", "")] = req.body[key];
                }
            });
            req.session.save();
            res.redirect(302, "/");
            return;
        }

        await renderUserPreferencesPage(req, res);
        return;
    }
    next();
};

app.use([
    verifySystemInitialized, 
    verifySession, 
    verifySessionEnded, 
    verifySessionCode, 
    verifyUserConsent,
    verifyUserPreferences
]);

async function renderUserPreferencesPage(req, res) {
    // user preferences page. consists of (1) user preferences and (2) agent configuration.
    
    // (1) user preferences: the name and image of the agent.
    const avatars = await helpers.listAvatars();
    let renderParams = helpers.getRenderingParamsForPage("user_preferences");
    // renderParams["user_avatar"] = avatars;
    renderParams["agent_avatar"] = avatars;
    renderParams["text_preferences"] = {
        //"user_name": "Choose your prefferred chat name:",
        "agent_name": "Choose your prefferred agent name:",
    } 

    // (2) agent configuration: the user might be required to choose some properties according to the treatment group configuration.
    const filteredRecords = helpers.getSelectedRecords(req);
    let recordsByProperty = helpers.groupRecordsByProperty(filteredRecords);
    let userConfigProperties = helpers.filterUserConfigProperties(recordsByProperty);
    const userPropertiesCount = Object.keys(userConfigProperties).length;

    if (userPropertiesCount > 0) {
        // according to the csv, the user has some properties to decide on.
        if (Object.keys(req.session.userConfigFilter).length == 0) {
            // this is the expected case, when the csv is set to let the user choose the properties.
            renderParams["userConfig"] = userConfigProperties
        } else {
            // should not happen.
            // if we reached here, this means the user was required to choose a property, but the user config is not complete (i.e. some properties were not decided).
            console.log("Properties are not filtered correctly!. uid: " + req.session.uid + ", treatment group: " + req.session.treatmentGroupId + ", user config filter is set to : " + JSON.stringify(userConfigProperties));
            renderParams = helpers.getRenderingParamsForPage("error");
            renderParams["body_message"] = "Properties are not filtered correctly! Please contact the experimenter.";
            res.render('./error', renderParams);
            return;
        }
    }

    res.render('./user_preferences',  renderParams);
}

app.get('/', async (req, res) => {
    // At this point, the hidden prompts are ready (either the user did not need to choose or the user has already configured the properties).
    // Save the hidden prompts to the session and redirect to the chat page, where the main interaction happens.
    helpers.setSelectedHiddenPromptToSession(req);
    helpers.logHiddenPrompts(req);
    let renderParams = helpers.getRenderingParamsForPage("chat");
    renderParams["preferences"] = req.session.preferences;
    renderParams["header_message"] = helpers.getUserTaskDescription(req);
    renderParams["body_message"] = "";
    res.render('./chat', renderParams);
});

// the main chat route.
// each part of the conversation is stored in the session
// the conversation context is sent to the openai chat api
// response is sent back to the client
app.post('/chat-api', async (req, res) => {
    const message = req.body.message;
    req.session.conversationContext.push({ role: 'user', content: message, interactionTime: helpers.getAndResetInteractionTime(req) });
    const messageWithContext = helpers.createFullConversationPrompt(req);
    try {
        const chatCompletion = await openai.chat.completions.create({
            messages: messageWithContext,
            model: 'gpt-3.5-turbo',
            //model: "gpt-3.5-turbo-0125",
            //model: "gpt-4",
            max_tokens: config.apiTokenLimit,
            temperature: 0.7
        });
        const apiReply = chatCompletion.choices[0].message.content;
        req.session.conversationContext.push({ role: 'assistant', content: apiReply, interactionTime: helpers.getAndResetInteractionTime(req) });
        req.session.save();
        res.send(apiReply);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error processing request' });
    }
});

app.get('/chat-ended', (req, res) => {
    let renderParams = helpers.getRenderingParamsForPage("user_questionnaire");
    renderParams["questions"] = {};

    helpers.getUserQuestionnaireRecords().map((record) => { 
        const k = record["question_name"];
        const v = record["question_text"];
        const is_text = record["is_text"] == "1" ? true : false;
        const is_radio_selection = record["is_radio_selection"] == "1" ? true : false ;
        renderParams["questions"][k] = {"label": v, "is_text": is_text, "is_radio_selection": is_radio_selection};
    });

    res.render('./user_questionnaire',  renderParams);
});

// session has finished.
// questionnaires answers are obtained.
// go to chat gpt and obtain sentiment analysis score for each user message
// save data to the database / csv / external source / etc.
app.post('/user_questionnaire-ended', async (req, res) => {
    req.session.finished = true;
    req.session.completionCode = helpers.getRandomInt(1000000000, 9999999999);
    req.session.save();
    if (!config.resultsRedirectUrl){
        let renderParams = helpers.getRenderingParamsForPage("session_ended");
        renderParams["completion_code"] = req.session.completionCode;
        res.render('./session_ended', renderParams);
    }

    // collect the questionnaire answers from request body
    helpers.getUserQuestionnaireRecords().map((record) => { req.session.quessionsAnswers[record["question_name"]] = req.body[record["question_name"]] });
    
    await getSentimentAnalysisScore(req);
    const savedResultsObj = helpers.saveSessionResults(req);
    await helpers.setCodeCompleted(req.session.code, {time: Date.now(), uid: req.session.uid, completionCode: req.session.completionCode});
    req.session.destroy();
    console.log("Session ended. uid: " + savedResultsObj.uid);
    
    if (config.resultsRedirectUrl) {
        req.body = savedResultsObj;
        // redirect to the results page with POST method
        res.redirect(307, config.resultsRedirectUrl);
    }
});

// test design route
app.get("/DesignTest", (req,res)=>{
    res.render("chat_design");
})

app.get("/DesignTest2", (req,res)=>{
    res.render("config_design");
})

app.use("*", (req, res) => { 
    res.redirect('/');
});

async function getSentimentAnalysisScoreForMessage(message) {
    const measurementRecords = helpers.getMeasuresRecords().filter((measureRecord) => measureRecord["is_global"] === "0" );
    const completions = await Promise.all(
        measurementRecords.map(async (measureRecord) => {
            const measureContent =  measureRecord["measure_prompt_prefix"];
            return await openai.chat.completions.create({
                    messages: [{role:"system", content: measureContent}, { role:"user", content: message }],
                    model: 'gpt-3.5-turbo',
                    max_tokens: config.apiTokenLimit,
                    temperature: 0.1
            });    
        }));

    let measures = [];
    measurementRecords.map((measureRecord, index) => {
        measures.push({"measure_name" : measureRecord["measure_name"], "measure_value" : completions[index].choices[0].message.content});
    });
    
    return measures;
}

async function getSentimentAnalysisScoreForConversation(req) {
    const measurementRecords = helpers.getMeasuresRecords().filter((measureRecord) =>  measureRecord["is_global"] !== "0" );
    const completions = await Promise.all(
        measurementRecords.map(async (measureRecord) => {
            const measureContent =  measureRecord["measure_prompt_prefix"];
            const conversation = req.session.conversationContext.filter((c) => c.role != "system");
            const messages = [{role:"system", content: measureContent}].concat(conversation).map(c => ({role: c.role, content: c.content }));
            return await openai.chat.completions.create({
                    messages: messages,
                    model: 'gpt-3.5-turbo',
                    max_tokens: config.apiTokenLimit,
                    temperature: 0.1
            });    
        }));

    measurementRecords.map((measureRecord, index) => {
        req.session.global_measures[measureRecord["measure_name"]] = completions[index].choices[0].message.content;
    });
}

// using chatgpt api, set a new chat with a system role for getting sentiment score.
async function getSentimentAnalysisScore(req) {
    try {
        const messageMeasuresPromises = req.session.conversationContext.filter(c => c.role === "user").map(async (element) => {
            let measures = await getSentimentAnalysisScoreForMessage(element.content);
            measures.forEach((measure) => {
                element[measure["measure_name"]] = measure["measure_value"];
            });
        })
        await Promise.all(messageMeasuresPromises);
        await getSentimentAnalysisScoreForConversation(req);
        req.session.save()
    } catch (error) {
        console.error(error);
    }
}



const port = process.env.PORT || 3030;
app.listen(port, () => console.log(`Server running on port ${port}`));

