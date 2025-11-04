// Load required packages
var mongoose = require('mongoose');

// Define our user schema
var UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'User name is required.'] // Validation
    },
    email: {
        type: String,
        required: [true, 'User email is required.'], // Validation
        unique: true,
        trim: true,
        lowercase: true
    },
    pendingTasks: [{
        type: String,
        ref: 'Task'
    }],
    dateCreated: {
        type: Date,
        default: Date.now // default
    }
});

// Export the Mongoose model
module.exports = mongoose.model('User', UserSchema);
