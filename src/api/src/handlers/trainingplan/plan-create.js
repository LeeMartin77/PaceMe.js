import { v4 as uuidv4 } from 'uuid';

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
exports.planCreate = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        throw new Error(`postMethod only accepts POST method, you tried: ${event.httpMethod} method.`);
    }
    
    // All log statements are written to CloudWatch
    console.info('received:', event);

    // TODO: Start verifying JWT, but given AWS does it, not a huge deal.
    const decodedJwt = jwt.decode(event.headers["Authorization"].replace('Bearer ', ''), { complete: true })
    const userId = decodedJwt.payload.sub

    // Get id and name from the body of the request
    const body = JSON.parse(event.body)
    const name = body.name;

    const newItem = { 
        id : uuidv4(),
        userId: userId,
        name: name 
    }

    // Creates a new item, or replaces an old item with a new item
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#put-property
    var params = {
        TableName : tableName,
        Item: newItem
    };

    const result = await docClient.put(params).promise();

    const response = {
        statusCode: 200,
        headers: {
            "Access-Control-Allow-Headers" : "Content-Type, Authorization",
            "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify(newItem)
    };

    // All log statements are written to CloudWatch
    console.info(`response from: ${event.path} statusCode: ${response.statusCode} body: ${response.body}`);
    return response;
}
