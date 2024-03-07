const express = require('express');
const bodyParser = require('body-parser');
const OpenAIApi = require("openai");


const app = express();
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }))

const tokenLimit = process.env.OPENAI_TOKEN_LIMIT || 20; 
const conversationSystemRoleDefaultContent = "You are acting like a human. You are a little sarcastic and have a good sense of humor. don't let anybody know you are an AI model.";
var conversationSystemRole = {"role": "system", "content": conversationSystemRoleDefaultContent};
var conversationContext = []

app.get('/', async (req, res) => {
    res.sendFile(__dirname + '/chat.html');    
})

app.post('/chat-api-manipulation', async (req, res) => {
    const message = req.body.manipulation;
    if (req.body.manupulation.length > 0) {
        conversationSystemRole["content"] = req.body.manupulation;
    }
    else {
        conversationSystemRole["content"] = conversationSystemRoleDefaultContent;
    }
    res.send(conversationSystemRole["content"]);
});

app.get('/chat-api-reset', async (req, res) => {
    conversationContext = [];
    res.send("Chat context reset");
});

app.post('/chat-api', async (req, res) => {
    const message = req.body.message;
    conversationContext.push({ role: 'user', content: message });
    const messageWithContext = conversationContext.slice(0, -1).concat([conversationSystemRole]).concat(conversationContext.slice(-1));
    // const messageWithContext = [conversationSystemRole].concat(conversationContext.concat);
    // const messageWithContext = conversationContext.concat([conversationSystemRole]);
    try {
        const openai = new OpenAIApi({
            apiKey: process.env['OPENAI_API_KEY'], // This is the default and can be omitted
          });
          
        const chatCompletion = await openai.chat.completions.create({
            messages: messageWithContext,
            model: 'gpt-3.5-turbo',
            //model: "gpt-3.5-turbo-0125",
            max_tokens: tokenLimit,
            temperature: 0.7
        });
        const apiReply = chatCompletion.choices[0].message.content;
        conversationContext.push({ role: 'assistant', content: apiReply });
        res.send(apiReply);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error processing request' });
    }
});


const port = process.env.PORT || 3030;
app.listen(port, () => console.log(`Server running on port ${port}`));

