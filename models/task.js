const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TaskSchema = new Schema({
    name: {
        type: String,
        required: [true, 'Task name is required.'] // Validation
    },
    deadline: {
        type: Date,
        required: [true, 'Task deadline is required.'] // Validation
    },
    completed: {
        type: Boolean,
        default: false // default
    },
    assignedUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: "" // default
    },
    assignedUserName: {
        type: String,
        default: 'unassigned' // Reasonable default
    },
    dateCreated: {
        type: Date,
        default: Date.now
    }
});

// Create and export the model
module.exports = mongoose.model('Task', TaskSchema);