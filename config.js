let config = {}
// openai
config.apiKey = process.env['OPENAI_API_KEY'];
config.apiTokenLimit = process.env["OPENAI_TOKEN_LIMIT"] || 50;

// postgres
config.pgUser = process.env['PGUSER'];
config.pgHost = process.env['PGHOST'];
config.pgDatabase = process.env['PGDBNAME'];
config.pgTable = process.env['PGTABLE'];
config.pgPassword = process.env['PGPASSWORD'];
config.pgPort = process.env['PGPORT'] || 5432;

// save results
config.resultsFile = process.env['RESULTS_FILE'];
config.resultsRedirectUrl = process.env['REDIRECT_URL'];
config.encodeBase64 = process.env['BASE64_ENCODE'];

module.exports = config;