// Create clients and set shared const values outside of the handler.

// Create a DocumentClient that represents the query to add an item
const dynamodb = require('aws-sdk/clients/dynamodb');
const docClient = new dynamodb.DocumentClient();
const jwt = require('jsonwebtoken')

// Get the DynamoDB table name from environment variables
const tableName = process.env.TRAINING_PLAN_TABLE;

/**
 * A simple example includes a HTTP post method to add one item to a DynamoDB table.
 */
exports.planDelete = async (event) => {
    if (event.httpMethod !== 'DELETE') {
        throw new Error(`only accepts DELETE method, you tried: ${event.httpMethod} method.`);
    }
    // All log statements are written to CloudWatch
    console.info('received:', event);

    // TODO: Start verifying JWT, but given AWS does it, not a huge deal.
    const decodedJwt = jwt.decode(event.headers["Authorization"].replace('Bearer ', ''), { complete: true })
    const userId = decodedJwt.payload.sub

    // Get id and name from the body of the request
    const id = event.pathParameters.id;

    var getParams = {
        TableName : tableName,
        Key: {id: id}
    };

    const existing = await docClient.get(getParams).promise();

    if (!!existing.Item || existing.Item.userId !== userId) {
        throw new Error(`No item with ${id} found`);
    }

    const result = await docClient.delete(getParams).promise();

    const response = {
        statusCode: 200,
        headers: {
            "Access-Control-Allow-Headers" : "Content-Type, Authorization",
            "Access-Control-Allow-Origin": "*"
        }
    };

    // All log statements are written to CloudWatch
    console.info(`response from: ${event.path} statusCode: ${response.statusCode} body: ${response.body}`);
    return response;
}
