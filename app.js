const express = require('express');
const bodyParser = require('body-parser');
const OpenAIApi = require("openai");
const session = require("express-session");
const cookieParser = require("cookie-parser");

const app = express();
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }))
// Initialization
app.use(cookieParser());
app.use(session({
    secret: "SSsseess",
    saveUninitialized: true,
    resave: true
}));

const tokenLimit = process.env.OPENAI_TOKEN_LIMIT || 20; 
const conversationSystemRoleDefaultContent = "You are acting like a human. You are a little sarcastic and have a good sense of humor. don't let anybody know you are an AI model.";

const maxUID = 100000;
function getRandomInt(min, max) {
    const minCeiled = Math.ceil(min);
    const maxFloored = Math.floor(max);
    return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled); // The maximum is exclusive and the minimum is inclusive
}

function getParamsToString(queryParams) {
    let params = '';
    let keys = Object.keys(queryParams);
    if (keys.length > 0) {
        params += "?";
        let pCount = 0;
        keys.forEach(k => {
            params += (k + "=" + queryParams[k]);
            if (pCount < keys.length - 1) {
                params += "&";
            }    
            pCount += 1;
        });
    }
    return params;
}

function craftPrompt(req) {
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

app.get('/', async (req, res) => {
    let uid = getRandomInt(0, maxUID);
    if ("uid" in req.query) {
        uid = req.query["uid"];
    }
    req.session.uid = uid;
    req.session.conversationSystemRole = {"role": "system", "content": conversationSystemRoleDefaultContent};
    req.session.conversationContext = []

    req.session.save();
    res.sendFile(__dirname + '/chat.html');    
})

app.post('/chat-api-manipulation', async (req, res) => {
    const message = req.body.manipulation;
    if (message.length > 0) {
        req.session.conversationSystemRole["content"] = message;
    }
    else {
        req.session.conversationSystemRole["content"] = conversationSystemRoleDefaultContent;
    }
    req.session.save();
    res.send(req.session.conversationSystemRole["content"]);
});

app.get('/chat-api-reset', async (req, res) => {
    req.session.conversationContext = [];
    req.session.save();

    res.send("Chat context reset");
});

app.post('/chat-api', async (req, res) => {
    const message = req.body.message;
    req.session.conversationContext.push({ role: 'user', content: message });
    const messageWithContext = craftPrompt(req);
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

const port = process.env.PORT || 3030;
app.listen(port, () => console.log(`Server running on port ${port}`));

