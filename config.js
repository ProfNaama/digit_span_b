let config = {}
// openai
config.apiKey = process.env['OPENAI_API_KEY'];
config.apiTokenLimit = parseInt(process.env["OPENAI_TOKEN_LIMIT"] || "200");

// postgres
config.connectionString = process.env['DATABASE_URL'];
config.pgTable = process.env['PGTABLE'] || "mem_test_results";

// save results
config.resultsFile = process.env['RESULTS_FILE'];
config.resultsRedirectUrl = process.env['REDIRECT_URL'];
config.encodeBase64 = process.env['BASE64_ENCODE'] && parseInt(process.env['BASE64_ENCODE']) != 0;

// secret code ... temporary
config.reusableCode = process.env['REUSABLE_CODE'];
module.exports = config;