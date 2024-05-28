let config = {}

// postgres
config.connectionString = process.env['DATABASE_URL'];
config.pgTable = process.env['PGTABLE'] || "digit_span_b_results";

// save results
config.resultsFile = process.env['RESULTS_FILE'];
config.resultsRedirectUrl = process.env['REDIRECT_URL'];
config.encodeBase64 = process.env['BASE64_ENCODE'] && parseInt(process.env['BASE64_ENCODE']) != 0;

// secret code ... temporary
config.reusableCode = process.env['REUSABLE_CODE'];

// number of digits
config.digits = process.env['DIGITS'] || 7;

module.exports = config;