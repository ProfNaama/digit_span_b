const express = require('express');
const bodyParser = require('body-parser');
const OpenAIApi = require("openai");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const csv = require('csv-parser')
const fs = require('fs');
const { log } = require('console');
const app = express();
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }))
app.set('view engine', 'pug');

const csvFileName = "experiment_config.csv";
const csvRecords = [];
let treatmentGroups = [];

fs.createReadStream(csvFileName)
    .pipe(csv())
    .on('data', (data) => csvRecords.push(data))
    .on('end', () => {
        //console.log(csvRecords);
        treatmentGroups = Array.from(new Set(csvRecords.map(r => parseInt(r["treatment_group"]))));
        //console.log(treatmentGroups);
    });

// Initialization
app.use(cookieParser());
app.use(session({
    secret: "SSsseess",
    saveUninitialized: true,
    resave: true
}));

const tokenLimit = process.env.OPENAI_TOKEN_LIMIT || 20; 
const conversationSystemRoleDefaultContent = "You are a little sarcastic and have a good sense of humor. don't let anybody know you are an AI model.";

const maxUID = 100000;
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

function mergeHiddenPrompts(prompts) {    
    let hiddenPromptPrefix = "You are a virtual assistant. You are interacting with a human person. You have the following set of human characharistics: ";
    if (prompts.length == 0) {
        return hiddenPromptPrefix + conversationSystemRoleDefaultContent;
    }
    return hiddenPromptPrefix + prompts.join("\n");
}

function setSelectedPromptToSession(req) {
    req.session.conversationSystemRoleDefaultContent = mergeHiddenPrompts(getSelectedPrompts(req));
    req.session.conversationSystemRole = {"role":"system", "content":req.session.conversationSystemRoleDefaultContent};
    req.session.save();
    console.log("uid: " + req.session.uid + ", treatment group: " + req.session.treatmentGroupId + ", hidden system role is set to : " + req.session.conversationSystemRoleDefaultContent);
}

function createFullConversationPrompt(req) {
    // const messageWithContext = [req.session.conversationSystemRole].concat(req.session.conversationContext.concat);
    // const messageWithContext = req.session.conversationContext.concat([req.session.conversationSystemRole]);

    const messageWithContext = req.session.conversationContext.slice(0, -1).concat(
        [req.session.conversationSystemRole]).concat(
            req.session.conversationContext.slice(-1));
    return messageWithContext;
}

const openai = new OpenAIApi({
    apiKey: process.env['OPENAI_API_KEY'], // This is the default and can be omitted
});

// This middleware will be executed for every request to the app, making sure the session is initialized with uid, treatment group id, etc.
app.use(async (req, res, next) => {
    if (!req.session.uid) {
        let uid = getRandomInt(0, maxUID);
        if ("uid" in req.query) {
            uid = parseInt(req.query["uid"]);
        }
        req.session.uid = uid;
        req.session.treatmentGroupId = treatmentGroups[(req.session.uid % treatmentGroups.length)];
        req.session.conversationContext = [];
        req.session.userConfigFilter = {};
        req.session.save();
        console.log("new session. uid: " + req.session.uid + ", treatment group: " + req.session.treatmentGroupId);
    }
    next();
});

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
    const filteredRecords = getSelectedRecords(req);
    let recordsByProperty = groupRecordsByProperty(filteredRecords);
    let userConfigProperties = filterUserConfigProperties(recordsByProperty);
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
    setSelectedPromptToSession(req);
    res.sendFile(__dirname + '/chat.html');
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
    req.session.conversationContext.push({ role: 'user', content: message });
    const messageWithContext = createFullConversationPrompt(req);
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
        req.session.conversationContext.push({ role: 'assistant', content: apiReply });
        req.session.save();
        res.send(apiReply);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error processing request' });
    }
});


// backdoor hacks for developing stages
app.post('/chat-api-manipulation', async (req, res) => {
    const message = req.body.manipulation;
    if (message.length > 0) {
        req.session.conversationSystemRole["content"] = message;
    }
    else {
        setSelectedPromptToSession(req)
    }
    req.session.save();
    res.send(req.session.conversationSystemRole["content"]);
});

// backdoor hacks for developing stages
app.get('/chat-api-reset', async (req, res) => {
    req.session.conversationContext = [];
    req.session.save();

    res.send("Chat context reset");
});

const port = process.env.PORT || 3030;
app.listen(port, () => console.log(`Server running on port ${port}`));

