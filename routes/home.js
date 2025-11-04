const User = require('../models/user');
const Task = require('../models/task');

module.exports = function (router) {

    // --- Helper Function for Query Parsing ---
    /**
     * Parses and applies common query parameters to a Mongoose query object.
     * @param {mongoose.Query} query - The Mongoose query to modify.
     * @param {Object} queryParams - The req.query object from Express.
     * @returns {mongoose.Query} The modified Mongoose query.
     */
    const parseQuery = (query, queryParams) => {
        // where: Filter results
        if (queryParams.where) {
            try {
                query.where(JSON.parse(queryParams.where));
            } catch (e) {
                console.warn("Invalid 'where' JSON provided:", queryParams.where);
            }
        }

        // sort: Specify sorting
        if (queryParams.sort) {
            try {
                query.sort(JSON.parse(queryParams.sort));
            } catch (e) {
                console.warn("Invalid 'sort' JSON provided:", queryParams.sort);
            }
        }

        // select: Specify fields to include/exclude
        if (queryParams.select) {
            try {
                query.select(JSON.parse(queryParams.select));
            } catch (e) {
                console.warn("Invalid 'select' JSON provided:", queryParams.select);
            }
        }

        // skip: Specify number of results to skip
        if (queryParams.skip) {
            query.skip(parseInt(queryParams.skip));
        }

        // limit: Specify number of results to return
        if (queryParams.limit) {
            query.limit(parseInt(queryParams.limit));
        }


        return query;
    };

    // --- Base Route (from your template) ---
    var homeRoute = router.route('/');
    homeRoute.get(function (req, res) {
        var connectionString = process.env.TOKEN ? "******" : "Not Set";
        res.status(200).json({
            message: 'Llama.io API is live!',
            data: 'My connection string is ' + connectionString
        });
    });

    // --- /api/users ---
    router.route('/users')

        /**
         * GET /api/users
         * Retrieve a list of users, supporting query parameters.
         */
        .get(async (req, res) => {
            try {
                let query = User.find();

                // Apply common query parameters
                query = parseQuery(query, req.query);

                // count: Return count instead of documents
                if (req.query.count === 'true') {
                    const count = await query.countDocuments();
                    return res.status(200).json({
                        message: "OK",
                        data: count
                    });
                }

                // Execute query
                const users = await query.exec();
                return res.status(200).json({
                    message: "OK",
                    data: users
                });

            } catch (err) {
                console.error("Error in GET /api/users:", err); // Added console log
                let statusCode = 500;
                let message = "An internal server error occurred while fetching users.";

                if (err instanceof SyntaxError || err instanceof TypeError) {
                    statusCode = 400;
                    message = "Invalid JSON or parameter format in query string.";
                }

                return res.status(statusCode).json({
                    message: message,
                    data: null
                });
            }
        })

        /**
         * POST /api/users
         * Create a new user.
         */
        .post(async (req, res) => {
            try {
                // Server-side validation
                if (!req.body.name || !req.body.email) {
                    return res.status(400).json({
                        message: "Validation Error: 'name' and 'email' are required fields.",
                        data: null
                    });
                }

                // Create new user instance
                const newUser = new User({
                    name: req.body.name,
                    email: req.body.email,
                    pendingTasks: req.body.pendingTasks || []
                    // dateCreated is set by default in the schema
                });

                // Save the user
                const savedUser = await newUser.save();

                return res.status(201).json({
                    message: "User created successfully",
                    data: savedUser
                });

            } catch (err) {
                console.error("Error in POST /api/users:", err.code, err.message);

                let statusCode = 500;
                let message = "An internal server error occurred while creating the user.";

                if (err.name === 'ValidationError' || (err.code && err.code === 11000) || err.message === 'This email is already in use.') {
                    statusCode = 400;
                    if (err.code === 11000 || err.message === 'This email is already in use.') {
                        message = "Validation Error: This email is already in use.";
                    }else {
                        message = `Validation Error: ${err.message}`;
                    }
                } else if (err.name === 'MongooseServerSelectionError') {
                    statusCode = 500;
                    message = "Database connection error. Please check Atlas IP whitelist and connection string.";
                }

                return res.status(statusCode).json({
                    message: message,
                    data: null
                });
            }
        });

    // --- /api/users/:id ---
    router.route('/users/:id')

        /**
         * GET /api/users/:id
         * Retrieve a specific user by ID.
         */
        .get(async (req, res) => {
            try {
                let query = User.findById(req.params.id);

                // Apply 'select' parameter if present
                if (req.query.select) {
                    query.select(JSON.parse(req.query.select));
                }

                const user = await query.exec();

                // Check if user was found
                if (!user) {
                    return res.status(404).json({
                        message: "User not found",
                        data: null
                    });
                }

                return res.status(200).json({
                    message: "OK",
                    data: user
                });

            } catch (err) {
                console.error(`Error in GET /api/users/${req.params.id}:`, err);
                let statusCode = 500;
                let message = "An internal server error occurred.";

                if (err.name === 'CastError') {
                    statusCode = 400;
                    message = "Invalid user ID format.";
                } else if (err instanceof SyntaxError) {
                    statusCode = 400;
                    message = "Invalid JSON in 'select' query parameter.";
                }

                return res.status(statusCode).json({
                    message: message,
                    data: null
                });
            }
        })

        /**
         * PUT /api/users/:id
         * Replace an entire user with new data.
         * Handles two-way reference for 'pendingTasks'.
         */
        .put(async (req, res) => {
            try {
                // Validation for required fields
                if (!req.body.name || !req.body.email) {
                    return res.status(400).json({
                        message: "Validation Error: 'name' and 'email' are required fields.",
                        data: null
                    });
                }

                // Data for replacement
                const replacementData = {
                    name: req.body.name,
                    email: req.body.email,
                    pendingTasks: Array.isArray(req.body.pendingTasks) ? req.body.pendingTasks : []
                };

                // --- Data Integrity: "PUT a User with pendingTasks" ---
                // Get the user's old state
                const oldUser = await User.findById(req.params.id).lean();
                if (!oldUser) {
                    return res.status(404).json({ message: "User not found", data: null });
                }

                const oldTasks = oldUser.pendingTasks || [];
                const newTasks = replacementData.pendingTasks;

                // Find tasks that were added to the user
                const addedTasks = newTasks.filter(t => !oldTasks.includes(t));
                if (addedTasks.length > 0) {
                    const completedTasks = await Task.find({
                        _id: { $in: addedTasks },
                        completed: true
                    }).select('name'); // Get the name for a good error message

                    if (completedTasks.length > 0) {
                        const taskNames = completedTasks.map(t => `"${t.name}"`).join(', ');
                        return res.status(400).json({
                            message: `Validation Error: Cannot add completed tasks to pendingTasks. The following tasks are already completed: ${taskNames}`,
                            data: null
                        });
                    }
                }

                // Find tasks that were removed from the user
                const removedTasks = oldTasks.filter(t => !newTasks.includes(t));

                // Update tasks that were added: assign them to this user
                if (addedTasks.length > 0) {
                    await Task.updateMany(
                        { _id: { $in: addedTasks } },
                        { $set: { assignedUser: oldUser._id.toString(), assignedUserName: replacementData.name } }
                    );
                }

                // Update tasks that were removed: unassign them
                if (removedTasks.length > 0) {
                    await Task.updateMany(
                        { _id: { $in: removedTasks } },
                        { $set: { assignedUser: "", assignedUserName: "unassigned" } }
                    );
                }
                // --- End Data Integrity ---

                // Perform the replacement
                const updatedUser = await User.findByIdAndUpdate(
                    req.params.id,
                    replacementData,
                    { new: true, overwrite: true, runValidators: true, context: 'query' }
                );

                return res.status(200).json({
                    message: "User replaced successfully",
                    data: updatedUser
                });

            } catch (err) {
                console.error(`Error in PUT /api/users/${req.params.id}:`, err); // Added console log
                let statusCode = 500;
                let message = "An internal server error occurred.";

                if (err.name === 'CastError') {
                    statusCode = 400;
                    message = "Invalid user ID format.";
                } else if (err.name === 'ValidationError' || (err.code && err.code === 11000)) {
                    statusCode = 400;
                    message = "Validation Error: Could not update user.";
                    if (err.code === 11000) {
                        message = "Validation Error: This email is already in use.";
                    } else {
                        message = `Validation Error: ${err.message}`;
                    }
                } else if (err.name === 'MongooseServerSelectionError') {
                    statusCode = 500;
                    message = "Database connection error. Please check Atlas IP whitelist and connection string.";
                }

                return res.status(statusCode).json({
                    message: message,
                    data: null
                });
            }
        })

        /**
         * DELETE /api/users/:id
         * Delete a specific user by ID.
         * Handles two-way reference (unassigns their tasks).
         */
        .delete(async (req, res) => {
            try {
                const deletedUser = await User.findByIdAndDelete(req.params.id);

                if (!deletedUser) {
                    return res.status(404).json({ // Typo fix: was 44
                        message: "User not found",
                        data: null
                    });
                }

                // --- Data Integrity: "DELETE a User" ---
                // Unassign all tasks that were pending for this user
                if (deletedUser.pendingTasks && deletedUser.pendingTasks.length > 0) {
                    await Task.updateMany(
                        { _id: { $in: deletedUser.pendingTasks } },
                        { $set: { assignedUser: "", assignedUserName: "unassigned" } }
                    );
                }
                // --- End Data Integrity ---

                return res.status(204).json({
                    message: "User deleted successfully",
                    data: deletedUser
                });

            } catch (err) {
                console.error(`Error in DELETE /api/users/${req.params.id}:`, err); // Added console log
                let statusCode = 500;
                let message = "An internal server error occurred.";

                if (err.name === 'CastError') {
                    statusCode = 400;
                    message = "Invalid user ID format.";
                } else if (err.name === 'MongooseServerSelectionError') {
                    statusCode = 500;
                    message = "Database connection error. Please check Atlas IP whitelist and connection string.";
                }

                return res.status(statusCode).json({
                    message: message,
                    data: null
                });
            }
        });


    // --- /api/tasks ---
    router.route('/tasks')

        /**
         * GET /api/tasks
         * Retrieve a list of tasks, supporting query parameters.
         * Default limit is 100.
         */
        .get(async (req, res) => {
            try {
                let query = Task.find();

                // Apply common query parameters (with custom limit handling)
                const queryParams = { ...req.query };

                // Set default limit for tasks
                if (!queryParams.limit) {
                    queryParams.limit = 100;
                }

                query = parseQuery(query, queryParams);

                // count: Return count instead of documents
                if (req.query.count === 'true') {
                    const count = await query.countDocuments();
                    return res.status(200).json({
                        message: "OK",
                        data: count
                    });
                }

                // Execute query
                const tasks = await query.exec();
                return res.status(200).json({
                    message: "OK",
                    data: tasks
                });

            } catch (err) {
                console.error("Error in GET /api/tasks:", err); // Added console log
                let statusCode = 500;
                let message = "An internal server error occurred while fetching tasks.";

                if (err instanceof SyntaxError || err instanceof TypeError) {
                    statusCode = 400;
                    message = "Invalid JSON or parameter format in query string.";
                }

                return res.status(statusCode).json({
                    message: message,
                    data: null
                });
            }
        })

        /**
         * POST /api/tasks
         * Create a new task.
         * Handles two-way reference (adds task to user's 'pendingTasks').
         * Includes FIX for Python script data types.
         */
        .post(async (req, res) => {
            try {
                // Server-side validation
                if (!req.body.name || !req.body.deadline) {
                    return res.status(400).json({
                        message: "Validation Error: 'name' and 'deadline' are required fields.",
                        data: null
                    });
                }

                // --- FIX: Sanitize incoming data from the Python script ---

                // 1. Parse the 'deadline' string.
                // The script sends a float-string (e.g., "1730421319000.0").
                // parseFloat() converts it to a number, which new Date() CAN handle.
                let deadlineInput = req.body.deadline;
                let deadlineDate;

                // Check if it's a number or a float-string
                if (!isNaN(parseFloat(deadlineInput)) && isFinite(deadlineInput)) {
                    deadlineDate = new Date(parseFloat(deadlineInput));
                } else {
                    // Otherwise, parse it as a standard date string
                    deadlineDate = new Date(deadlineInput);
                }

                // 2. Parse the 'completed' string.
                // The script sends "true" or "false" as strings.
                const completedStatus = (req.body.completed === 'true');

                let validUserName = "unassigned";
                if (req.body.assignedUser) {
                    const user = await User.findById(req.body.assignedUser);

                    if (!user) {
                        return res.status(404).json({
                            message: "Error: Cannot assign task to a user that does not exist.",
                            data: null
                        });
                    }

                    // Check if the provided name matches the user's actual name
                    if (req.body.assignedUserName !== user.name) {
                        return res.status(400).json({
                            message: `Validation Error: 'assignedUserName' ("${req.body.assignedUserName}") does not match the name of the user ("${user.name}").`,
                            data: null
                        });
                    }
                    validUserName = user.name;
                }

                // Create new task instance
                const newTask = new Task({
                    name: req.body.name,
                    description: req.body.description || "",
                    deadline: deadlineDate, // Use the parsed date
                    completed: completedStatus, // Use the parsed boolean
                    assignedUser: req.body.assignedUser || "",
                    assignedUserName: validUserName
                    // dateCreated is set by default
                });

                // Save the task
                const savedTask = await newTask.save();

                // --- Data Integrity: "POST a Task" ---
                // If assigned to a user, add this task to their pendingTasks list
                if (savedTask.assignedUser && !savedTask.completed) { // Only add if not already completed
                    await User.findByIdAndUpdate(
                        savedTask.assignedUser,
                        // $addToSet prevents duplicates
                        { $addToSet: { pendingTasks: savedTask._id.toString() } }
                    );
                }
                // --- End Data Integrity ---

                return res.status(201).json({
                    message: "Task created successfully",
                    data: savedTask
                });

            } catch (err) {
                console.error("Error in POST /api/tasks:", err); // Added console log
                let statusCode = 500;
                let message = "An internal server error occurred while creating the task.";

                if (err.name === 'ValidationError') {
                    statusCode = 400;
                    message = `Validation Error: ${err.message}`;
                } else if (err.name === 'MongooseServerSelectionError') {
                    statusCode = 500;
                    message = "Database connection error. Please check Atlas IP whitelist and connection string.";
                }

                return res.status(statusCode).json({
                    message: message,
                    data: null
                });
            }
        });

    // --- /api/tasks/:id ---
    router.route('/tasks/:id')

        /**
         * GET /api/tasks/:id
         * Retrieve a specific task by ID.
         */
        .get(async (req, res) => {
            try {
                let query = Task.findById(req.params.id);

                // Apply 'select' parameter if present
                if (req.query.select) {
                    query.select(JSON.parse(req.query.select));
                }

                const task = await query.exec();

                // Check if task was found
                if (!task) {
                    return res.status(404).json({
                        message: "Task not found",
                        data: null
                    });
                }

                return res.status(200).json({
                    message: "OK",
                    data: task
                });

            } catch (err) {
                console.error(`Error in GET /api/tasks/${req.params.id}:`, err); // Added console log
                let statusCode = 500;
                let message = "An internal server error occurred.";

                if (err.name === 'CastError') {
                    statusCode = 400;
                    message = "Invalid task ID format.";
                } else if (err instanceof SyntaxError) {
                    statusCode = 400;
                    message = "Invalid JSON in 'select' query parameter.";
                }

                return res.status(statusCode).json({
                    message: message,
                    data: null
                });
            }
        })

        /**
         * PUT /api/tasks/:id
         * Replace an entire task with new data.
         * Handles two-way reference (updates old and new users' 'pendingTasks').
         */
        .put(async (req, res) => {
            try {
                // Validation for required fields
                if (!req.body.name || !req.body.deadline) {
                    return res.status(400).json({
                        message: "Validation Error: 'name' and 'deadline' are required fields.",
                        data: null
                    });
                }

                // --- FIX: Sanitize incoming data from the Python script ---
                let deadlineDate = req.body.deadline;
                if (typeof req.body.deadline === 'string') {
                    const parsedDate = new Date(parseFloat(req.body.deadline));
                    if (!isNaN(parsedDate.getTime())) {
                        deadlineDate = parsedDate;
                    }
                }

                let completedStatus = req.body.completed;
                if (typeof req.body.completed === 'string') {
                    completedStatus = (req.body.completed === 'true');
                }

                let validUserName = "unassigned";
                if (req.body.assignedUser) {
                    const user = await User.findById(req.body.assignedUser);

                    if (!user) {
                        return res.status(404).json({
                            message: "Error: Cannot assign task to a user that does not exist.",
                            data: null
                        });
                    }

                    // Check if the provided name matches the user's actual name
                    if (req.body.assignedUserName !== user.name) {
                        return res.status(400).json({
                            message: `Validation Error: 'assignedUserName' ("${req.body.assignedUserName}") does not match the name of the user ("${user.name}").`,
                            data: null
                        });
                    }
                    validUserName = user.name;
                } else {
                    // If the user is being unassigned, ensure the name is also "unassigned"
                    if (req.body.assignedUserName && req.body.assignedUserName !== "unassigned") {
                        return res.status(400).json({
                            message: `Validation Error: 'assignedUserName' must be "unassigned" when 'assignedUser' is not provided.`,
                            data: null
                        });
                    }
                }

                const replacementData = {
                    ...req.body,
                    deadline: deadlineDate,
                    completed: completedStatus
                };

                // --- Data Integrity: "PUT a Task" ---
                // Get the task's old state to see if assignedUser or completed status changed
                const oldTask = await Task.findById(req.params.id).lean();
                if (!oldTask) {
                    return res.status(404).json({ message: "Task not found", data: null });
                }

                // --- Block updates on completed tasks ---
                if (oldTask.completed) {
                    return res.status(400).json({
                        message: "Error: Cannot update a task that is already completed.",
                        data: null
                    });
                }
                const oldUserId = oldTask.assignedUser || "";
                const newUserId = replacementData.assignedUser || "";

                const wasCompleted = oldTask.completed;
                const nowCompleted = replacementData.completed;

                // Case 1: User assignment changed
                if (oldUserId !== newUserId) {
                    // Remove task from old user's list (if they exist)
                    if (oldUserId) {
                        await User.findByIdAndUpdate(
                            oldUserId,
                            { $pull: { pendingTasks: oldTask._id.toString() } }
                        );
                    }
                    // Add task to new user's list (if they exist and task is not complete)
                    if (newUserId && !nowCompleted) {
                        await User.findByIdAndUpdate(
                            newUserId,
                            { $addToSet: { pendingTasks: oldTask._id.toString() } }
                        );
                    }
                }

                // Case 2: Task status changed
                if (wasCompleted !== nowCompleted && (newUserId || oldUserId)) { // Check if user is assigned
                    const relevantUserId = newUserId || oldUserId;
                    if (nowCompleted) {
                        // Task is now complete, remove from user's pending list
                        await User.findByIdAndUpdate(
                            relevantUserId,
                            { $pull: { pendingTasks: oldTask._id.toString() } }
                        );
                    } else {
                        // Task is no longer complete, add to user's pending list
                        await User.findByIdAndUpdate(
                            relevantUserId,
                            { $addToSet: { pendingTasks: oldTask._id.toString() } }
                        );
                    }
                }
                // --- End Data Integrity ---

                // Perform the replacement
                const updatedTask = await Task.findByIdAndUpdate( // Typo fix: was User.findByIdAndUpdate
                    req.params.id,
                    replacementData,
                    { new: true, overwrite: true, runValidators: true, context: 'query' }
                );

                return res.status(200).json({
                    message: "Task replaced successfully",
                    data: updatedTask
                });

            } catch (err) {
                console.error(`Error in PUT /api/tasks/${req.params.id}:`, err); // Added console log
                let statusCode = 500;
                let message = "An internal server error occurred.";

                if (err.name === 'CastError') {
                    statusCode = 400;
                    message = "Invalid task ID format.";
                } else if (err.name === 'ValidationError') {
                    statusCode = 400;
                    message = `Validation Error: ${err.message}`;
                } else if (err.name === 'MongooseServerSelectionError') {
                    statusCode = 500;
                    message = "Database connection error. Please check Atlas IP whitelist and connection string.";
                }

                return res.status(statusCode).json({
                    message: message,
                    data: null
                });
            }
        })

        /**
         * DELETE /api/tasks/:id
         * Delete a specific task by ID.
         * Handles two-way reference (removes task from user's 'pendingTasks').
         */
        .delete(async (req, res) => {
            try {
                const deletedTask = await Task.findByIdAndDelete(req.params.id);

                if (!deletedTask) {
                    return res.status(404).json({
                        message: "Task not found",
                        data: null
                    });
                }

                // --- Data Integrity: "DELETE a Task" ---
                // If task was assigned, remove it from the user's pendingTasks list
                if (deletedTask.assignedUser) {
                    await User.findByIdAndUpdate(
                        deletedTask.assignedUser,
                        { $pull: { pendingTasks: deletedTask._id.toString() } }
                    );
                }
                // --- End Data Integrity ---

                return res.status(204).json({
                    message: "Task deleted successfully",
                    data: deletedTask
                });

            } catch (err) {
                console.error(`Error in DELETE /api/tasks/${req.params.id}:`, err); // Added console log
                let statusCode = 500;
                let message = "An internal server error occurred.";

                if (err.name === 'CastError') {
                    statusCode = 400;
                    message = "Invalid task ID format.";
                } else if (err.name === 'MongooseServerSelectionError') {
                    statusCode = 500;
                    message = "Database connection error. Please check Atlas IP whitelist and connection string.";
                }

                return res.status(statusCode).json({
                    message: message,
                    data: null
                });
            }
        });

    // Return the configured router
    return router;
}

