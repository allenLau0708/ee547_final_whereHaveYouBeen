// AWS SDK v3
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb'); 
const { PutCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb'); 
const bcrypt = require('bcryptjs');
const { v4: uuidv4, validate } = require('uuid'); 
const { NotFoundError } = require('../middleware/error_handler');

const isLambda = !!process.env.AWS_EXECUTION_ENV;

const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-west-2',
    ...(isLambda
        ? {} 
        : {
              credentials: {
                  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
              },
          }),
});

async function signUp(user_name, password, email) {
    const user_id = uuidv4();

    const now = new Date().toISOString();
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const user = {
        user_id,
        user_name,
        password: hashedPassword,
        email,
        createTime: now,
        modifyTime: now,
    };

    const params = {
        TableName: 'user',
        Item: user,
    };

    const command = new PutCommand(params);
    await client.send(command);
    console.log(`User ${user.user_name} registered successfully!`);

    const user_key=await generateUserKey(user_id);
    return user_key;
}

async function login(email, password) {
    const params = {
        TableName: 'user',
        IndexName: 'email-index',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
            ':email': email,
        },
    };

    const command = new QueryCommand(params);
    const { Items } = await client.send(command);
    console.log(Items);
    if (!Items) {
        throw new NotFoundError('User not found');
    }

    const { user_id, password: hashedPassword } = Items[0];

    const isValid = await bcrypt.compare(password, hashedPassword);

    if (!isValid) {
        throw new NotFoundError('Invalid password');
    }
    console.log(`User ${user_id} logged in successfully!`);
    const user_key=await generateUserKey(user_id);
    return user_key;
}

async function generateUserKey(user_id) {
    const user_key = uuidv4();
    const now = new Date().toISOString();
    const validateTime = new Date(new Date(now).getTime() + 1000 * 60 * 60 * 1).toISOString();
    const params = {
        TableName: 'user_key',
        Item: {
            user_id,
            user_key,
            validateTime
        },
    };

    const command = new PutCommand(params);
    await client.send(command);

    console.log(`Key ${user_key} generated for user ${user_id}`);
    return user_key;
}

async function validateKey(user_key) {
    const params = {
        TableName: 'user_key',
        IndexName: 'user_key-index',
        KeyConditionExpression: 'user_key = :user_key',
        ExpressionAttributeValues: {
            ':user_key': user_key,
        },
    };

    const command = new QueryCommand(params);
    const response = await client.send(command);

    if (!response.Items || response.Items.length === 0) {
        throw new NotFoundError('Key not found');
    }

    const { user_id, validateTime } = response.Items[0];
    if (new Date(validateTime) < new Date()) {
        throw new NotFoundError('Key expired');
    }
    return user_id;
}



module.exports = {
    signUp,
    login,
    validateKey,
};