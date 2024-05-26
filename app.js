const express = require('express');
const bodyParser = require('body-parser');
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

// Middleware to initilaize the system
async function verifySystemInitialized(req, res, next) {
    await helpers.waitForSystemInitializiation(); 
    next();
};

// Middlewares to be executed for every request to the app, making sure the session is initialized with uid, treatment group id, etc.
function verifySession(req, res, next) {
    if (!req.session.uid) {
        req.session.uid = helpers.getRandomInt(0, maxUID).toString();
        req.session.conversationContext = [];
        req.session.lastInteractionTime = null;
        req.session.quessionsAnswers = {};
        req.session.code = null;
        req.session.completionCode = null;
        req.session.consent = false;
        req.session.finished = false;
        req.session.prolificUid = {};
        Object.keys(req.query).forEach(key => {
            let value = req.query[key];
            key = key.toLowerCase();
            if (key === "prolific_pid" || key === "study_id" || key === "session_id") {
                req.session.prolificUid[key] = value;
            }
        });
        req.session.sessionStartTime = new Date().toISOString();
        req.session.save();
        console.log("new session. uid: " + req.session.uid + 
            ", prolific_uid: " + req.session.prolificUid["prolific_pid"]);
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
                renderParams["header_message"] = "Thank You,";
                renderParams["body_message"] = "You opted out";
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

app.use([
    verifySystemInitialized, 
    verifySession, 
    verifySessionEnded, 
    verifySessionCode, 
    verifyUserConsent
]);

app.get('/', async (req, res) => {
    let renderParams = helpers.getRenderingParamsForPage("chat");
    renderParams["body_message"] = "";
    res.render('./chat', renderParams);
});

app.post('/mem-test-api', (req, res) => {
    if ("user_response" in req.body && req.session.conversationContext.length > 0){
        req.session.conversationContext[req.session.conversationContext.length-1]["user_response"] = req.body["user_response"];
    }

    if (req.session.conversationContext.length >= 5) {
        req.session.save();
        res.json([]);
    } else {
        let random_numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        // shuffle the array
        for (let i = 0; i < random_numbers.length; i++) {
            const randPos = helpers.getRandomInt(0, random_numbers.length);
            [random_numbers[i], random_numbers[randPos]] = [random_numbers[randPos], random_numbers[i]];
        }
        req.session.conversationContext.push({"random_numbers": random_numbers});
        req.session.save();
        res.json(random_numbers);
    }
});

app.get('/chat-ended', (req, res) => {
    let renderParams = helpers.getRenderingParamsForPage("user_questionnaire");
    renderParams["questions"] = helpers.getUserTestQuestions(req);
    res.render('./user_questionnaire',  renderParams);
});

// session has finished.
// questionnaires answers are obtained.
// go to chat gpt and obtain sentiment analysis score for each user message
// save data to the database / csv / external source / etc.
app.post('/user_questionnaire-ended', async (req, res) => {
    req.session.finished = true;
    req.session.completionCode = helpers.getRandomInt(1000000000, 9999999999);
    req.session.completionCode = "CJAAVSWW";
    req.session.user_questionnaire_ended = new Date().toISOString();
    req.session.save();
    if (!config.resultsRedirectUrl){
        let renderParams = helpers.getRenderingParamsForPage("session_ended");
        renderParams["completion_code"] = req.session.completionCode;
        res.render('./session_ended', renderParams);
    }

    // collect the questionnaire answers from request body
    helpers.getUserTestQuestions(req).map((record) => { req.session.quessionsAnswers[record["name"]] = req.body[record["name"]] });
    req.session.save();
    const savedResultsObj = helpers.saveSessionResults(req);
    await helpers.setCodeCompleted(req.session.code, {time: new Date().toISOString(), uid: req.session.uid, completionCode: req.session.completionCode});
    req.session.destroy();
    console.log("Session ended. uid: " + savedResultsObj.uid);
    
    if (config.resultsRedirectUrl) {
        req.body = savedResultsObj;
        // redirect to the results page with POST method
        res.redirect(307, config.resultsRedirectUrl);
    }
});


const port = process.env.PORT || 3030;
app.listen(port, () => console.log(`Server running on port ${port}`));

