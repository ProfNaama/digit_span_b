const express = require('express');
const bodyParser = require('body-parser');
// const axios = require('axios');
const OpenAIApi = require("openai");
// doesn't seem to work...

const app = express();
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }))

const tokenLimit = process.env.OPENAI_TOKEN_LIMIT || 20; 
var conversationSystemRole = {"role": "system", "content": "You are a highly polite and helpful assistant."};
var conversationContext = []

app.get('/', async (req, res) => {
    res.sendFile(__dirname + '/chat.html');    
})

app.post('/chat-api-manipulation', async (req, res) => {
    const message = req.body.manipulation;
    if (req.body.manupulation.length > 0) {
        conversationSystemRole["content"] = req.body.manupulation;
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

app.post('/chat-api-axios', async (req, res) => {
    // obtain message parameter from request body
    const message = req.body.message;

    try {
            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                messages: [
                    //{"role": "system", "content": "You are a highly polite and helpful assistant."},
                    //{"role": "user", "content": "Who won the world series in 2020?"},
                    //{"role": "assistant", "content": "The Los Angeles Dodgers won the World Series in 2020."},
                    {"role": "user", "content": message}
                ],
                model: "gpt-3.5-turbo",
                //model: "gpt-3.5-turbo-0125",
                response_format: { "type": "json_object" },
                max_tokens: tokenLimit,
                temperature: 0.7
            }, {
                headers: {
                    'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
                }
            });
        const apiReply = response.data.choices[0].text;
        res.send(apiReply);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error processing request' });
    }
});

const port = process.env.PORT || 3030;
app.listen(port, () => console.log(`Server running on port ${port}`));

