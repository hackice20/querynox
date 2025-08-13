const mongoose = require('mongoose')
const dotenv = require('dotenv')
dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    //await model.syncIndexes(); to sync Indexes if Required
    console.log("Connected to Database");
  } catch (error) {
    console.log("Error Connecting to Server " + error + "\n " + process.env.MONGOURI);
  }
};

module.exports = connectDB;