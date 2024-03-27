let config = {}
// openai
config.apiKey = process.env['OPENAI_API_KEY'];
config.apiTokenLimit = parseInt(process.env["OPENAI_TOKEN_LIMIT"] || "200");

// postgres
config.connectionString = process.env['DATABASE_URL'];
config.pgTable = process.env['PGTABLE'] || "results";

// save results
config.resultsFile = process.env['RESULTS_FILE'];
config.resultsRedirectUrl = process.env['REDIRECT_URL'];
config.encodeBase64 = process.env['BASE64_ENCODE'];

// secret... temporary
config.secret = process.env['SECRET'] || "secretsecret!";
module.exports = config;