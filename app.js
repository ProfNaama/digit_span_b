const express = require('express');
const bodyParser = require('body-parser');
const OpenAIApi = require("openai");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const app = express();
const helpers = require("./helpers.js");

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }))
app.set('view engine', 'pug');


// Initialization
app.use(cookieParser());
app.use(session({
    secret: "SSsseess",
    saveUninitialized: true,
    resave: true
}));

const tokenLimit = process.env.OPENAI_TOKEN_LIMIT || 50; 
const maxUID = 100000;

const openai = new OpenAIApi({
    apiKey: process.env['OPENAI_API_KEY'], // This is the default and can be omitted
});

// Middleware to initilaize the system
async function verifySystemInitialized(req, res, next) {
    helpers.waitForSystemInitializiation(); 
    next();
};

// Middlewares to be executed for every request to the app, making sure the session is initialized with uid, treatment group id, etc.
async function verifySessionMiddleware(req, res, next) {
    if (req.session.uid) {
        next();
        return;
    }

    let uid = helpers.getRandomInt(0, maxUID);
    if ("uid" in req.query) {
        uid = parseInt(req.query["uid"]);
    }

    req.session.uid = uid;
    req.session.treatmentGroupId = helpers.getTreatmentGroupId(uid);
    req.session.initialTask = ""
    req.session.systemRoleHiddenContent = "";
    req.session.conversationContext = [];
    req.session.userConfigFilter = {};
    req.session.lastInteractionTime = null;
    req.session.quessionsAnswers = null;
    req.session.finished = false;
    req.session.save();
    console.log("new session. uid: " + req.session.uid + ", treatment group: " + req.session.treatmentGroupId);
    res.render('./welcome_consent', { 
        "title":"ChatLab",  
        "header_message": helpers.getFirstCsvRecordValue(helpers.getCsvRecords("experiment_desc.csv"), "welcome_consent_header"),  
        "body_message": helpers.getFirstCsvRecordValue(helpers.getCsvRecords("experiment_desc.csv"), "welcome_consent_body")
    });
}

// Middlewares to be executed for every request to the app, making sure the session has not already finished.
async function verifySessionEndedMiddleware(req, res, next) {
    if (req.session.finished) {
        res.render('./session_ended', { 
            title: "ChatLab",  
            message: "Thank You for participating in the experiment. You can close the window now."
        });
        return;
    }
    next();
};

app.use([verifySystemInitialized, verifySessionMiddleware, verifySessionEndedMiddleware]);

function renderUserConfigPage(req, res, userConfigProperties, userPropertiesCount) {
    let userMessage = "Please select your preference regarding the following property.";
    if (userPropertiesCount > 1) {
        userMessage = "For each of the following properties, please select your preferences.";
    }
    if (Object.keys(req.session.userConfigFilter).length == 0) {
        // this is the expected case, when the csv is set to let the user choose the properties.
        res.render('./user_config', { 
            "title":"ChatLab",  
            "header_message":"This is an experiment in which you should configure the chat bot",  
            "body_message": userMessage,
            userConfig: userConfigProperties
        });
    } else {
        // should not happen.
        // if we reached here, this means the user was required to choose a property, but the user config is not complete (i.e. some properties were not decided).
        console.log("Properties are not filtered correctly!. uid: " + req.session.uid + ", treatment group: " + req.session.treatmentGroupId + ", user config filter is set to : " + JSON.stringify(userConfigProperties));
        res.render('./error', {
            "title":"ChatLab",  
            "header_message":"Error",  
            "body_message": "Properties are not filtered correctly! Please contact the experimenter."
        });
    }
}

app.get('/', async (req, res) => {
    const filteredRecords = helpers.getSelectedRecords(req);
    let recordsByProperty = helpers.groupRecordsByProperty(filteredRecords);
    let userConfigProperties = helpers.filterUserConfigProperties(recordsByProperty);
    const userPropertiesCount = Object.keys(userConfigProperties).length;

    if (userPropertiesCount > 0) {
        // according to the csv, the user has some properties to decide on.
        // we redirect the user to the user_config page, where the user can configure the properties.
        // after the user config is set, the user is redirected back to this route again.
        renderUserConfigPage(req, res, userConfigProperties, userPropertiesCount);
        return;
    }

    // At this point, the hidden prompts are ready (either the user did not need to choose or the user has already configured the properties).
    // Save the hidden prompts to the session and redirect to the chat page, where the main interaction happens.
    helpers.setSelectedHiddenPromptToSession(req);
    helpers.logHiddenPrompts(req);
    res.render('./chat', {
        "title":"ChatLab",  
        "header_message":"Error",  
        "body_message": "Properties are not filtered correctly! Please contact the experimenter."
    });
});

app.post('/user_config', async (req, res) => {
    // the user config is saved in the session, we redirect to the root route again, this time the config is already set.
    req.session.userConfigFilter = req.body;
    req.session.save();
    res.redirect('/');
});

// the main chat route.
// each part of the conversation is stored in the session
// the conversation context is sent to the openai chat api
// response is sent back to the client
app.post('/chat-api', async (req, res) => {
    const message = req.body.message;
    req.session.conversationContext.push({ role: 'user', content: message, interactionTime: helpers.getInteractionTime(req) });
    const messageWithContext = helpers.createFullConversationPrompt(req);
    try {
        const chatCompletion = await openai.chat.completions.create({
            messages: messageWithContext,
            model: 'gpt-3.5-turbo',
            //model: "gpt-3.5-turbo-0125",
            //model: "gpt-4",
            max_tokens: tokenLimit,
            temperature: 0.7
        });
        const apiReply = chatCompletion.choices[0].message.content;
        req.session.conversationContext.push({ role: 'assistant', content: apiReply, interactionTime: helpers.getInteractionTime(req) });
        req.session.save();
        res.send(apiReply);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error processing request' });
    }
});

app.get('/chat-api-ended', async (req, res) => {
    let params = {
        title : "ChatGptLab", 
        header_message: "Thank You for chatting..",
        body_message: "Please fill out the next set of questions.",
        questions: {}
    };

    helpers.getUserQuestionnaireRecords().map((record) => { 
        const k = record["question_name"];
        const v = record["question_text"];
        params["questions"][k] = v;
    });
    res.render('./user_questionnaire',  params);
});

// session has finished.
// questionnaires answers are obtained.
// go to chat gpt and obtain sentiment analysis score for each user message
// save data to the database / csv / external source / etc.
app.post('/user_questionnaire-ended', async (req, res) => {
    req.session.finished = true;
    req.session.save();
    res.render('./session_ended', { 
        title: "ChatLab",  
        message: "Thank You for participating in the experiment. You can close the window now."
    });

    if (!req.session.quessionsAnswers) {
        // collect the questionnaire answers from request body
        let questionnaireAnswers = {};
        helpers.getUserQuestionnaireRecords().map((record) => { questionnaireAnswers[record["question_name"]] = req.body[record["question_name"]] });
        req.session.quessionsAnswers = questionnaireAnswers;
        
        await getSentimentAnalysisScore(req);
        req.session.save();
        console.log("user_questionnaire-ended: quessionsAnswers: " + JSON.stringify(req.session.quessionsAnswers));
    }
});

// backdoor hacks for developing stages
app.post('/chat-api-manipulation', async (req, res) => {
    const message = req.body.manipulation;
    
    if (message.length > 0) {
        req.session.systemRoleHiddenContent = message;
        req.session.save();
    }
    else {
        helpers.setSelectedHiddenPromptToSession(req)
    }
    helpers.logHiddenPrompts(req);
    res.send({"manipulation": req.session.systemRoleHiddenContent}); 
});

// backdoor hacks for developing stages
app.post('/chat-api-manipulation-task', async (req, res) => {
    const task = req.body.task;
    
    req.session.initialTask = task;
    req.session.save();
    helpers.logHiddenPrompts(req);
    res.send({"task": task}); 
});

// backdoor hacks for developing stages
app.get('/chat-api-reset', async (req, res) => {
    req.session.conversationContext = [];
    req.session.save();
    helpers.logHiddenPrompts(req);

    res.send("Chat context reset");
});

async function getSentimentAnalysisScoreForMessage(message) {
    const completions = await Promise.all(
        helpers.getMeasuresRecords().map(async (measureRecord) => {
            // const measureContent =  measureRecord["measure_prompt_prefix"].replace("{}", message);
            const measureContent =  measureRecord["measure_prompt_prefix"].replace("{}", "");
            return await openai.chat.completions.create({
                messages: [{role:"system", content: measureContent}, { role:"user", content: message }],
                model: 'gpt-3.5-turbo',
                max_tokens: tokenLimit,
                temperature: 0.1
            });    
    }));

    let measures = [];
    helpers.getMeasuresRecords().map((measureRecord, index) => {
        measures.push({"measure_name" : measureRecord["measure_name"], "measure_value" : completions[index].choices[0].message.content});
    });
    return measures;
}

// using chatgpt api, set a new chat with a system role for getting sentiment score.
async function getSentimentAnalysisScore(req) {
    try {
        await Promise.all(
            req.session.conversationContext.filter(c => c.role === "user").map(async (element) => {
                let measures = await getSentimentAnalysisScoreForMessage(element.content);
                measures.forEach((measure) => {
                    element[measure["measure_name"]] = measure["measure_value"];
                });
            })
        );

        const generalEngagementRole = "You are an user engagement analysis tool. Please provide a score for the user engagement in the following conversation between user and assistant.";
        let interactions = [{role:"system", content: generalEngagementRole}];
        req.session.conversationContext.filter(c => c.role === "user" || c.role === "assistant" ).map(element => {
            interactions.push({"role": element.role, "content": element.content});
        });
        req.session.save()
    } catch (error) {
        console.error(error);
    }
    console.log("getSentimentAnalysisScore, full conversationContext: " + JSON.stringify(req.session.conversationContext));
}

const port = process.env.PORT || 3030;
app.listen(port, () => console.log(`Server running on port ${port}`));

