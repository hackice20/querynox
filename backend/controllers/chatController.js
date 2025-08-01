const User = require('../models/User');
const Chat = require('../models/Chat');
const ChatQuery = require('../models/ChatQuery');
const ragService = require('../services/ragService');
const webSearchService = require('../services/webSearchService');
const aiService = require('../services/aiService');

const chatController = {
    // --- NON-STREAMING METHODS ---
    createChat: async (req, res) => {
        try {
            const { clerkUserId, prompt, model, systemPrompt, webSearch } = req.body;
            const files = req.files;
            let user = await User.findOne({ userId: clerkUserId });
            if (!user) {
                user = new User({ userId: clerkUserId, chats: [] });
                await user.save();
            }
            const chatname = await aiService.generateChatname(prompt);
            const chat = new Chat({ userId: user._id, title: prompt.substring(0, 50), chatname: chatname });
            
            let context = '';
            if (webSearch === 'true' || webSearch === true) {
                context += await webSearchService.search(prompt);
            }
            if (files && files.length > 0) {
                context += await ragService.getContextFromFiles(prompt, files);
            }
            const augmentedPrompt = `${prompt}${context}`;
            const messages = [{ role: 'user', content: augmentedPrompt }];

            const assistantResponse = await aiService.generateResponse(model, messages, systemPrompt);

            await chat.save();
            const firstChatQuery = new ChatQuery({
                chatId: chat._id,
                prompt: prompt,
                model: model,
                systemPrompt: systemPrompt,
                webSearch: webSearch === 'true' || webSearch === true,
                response: assistantResponse
            });
            await firstChatQuery.save();
            user.chats.push(chat._id);
            await user.save();

            res.status(201).json({ chatId: chat._id, chatname: chat.chatname, response: assistantResponse });
        } catch (error) {
            console.error('Create Chat Error:', error);
            res.status(500).json({ error: 'An internal server error occurred.' });
        }
    },

    handleChat: async (req, res) => {
        try {
            const { clerkUserId, prompt, model, systemPrompt, webSearch } = req.body;
            const { chatId } = req.params;
            const files = req.files;
            
            const chat = await Chat.findById(chatId);
            if (!chat) return res.status(404).json({ error: 'Chat not found' });
            
            let context = '';
            if (webSearch === 'true' || webSearch === true) {
                context += await webSearchService.search(prompt);
            }
            if (files && files.length > 0) {
                context += await ragService.getContextFromFiles(prompt, files);
            }

            const previousQueries = await ChatQuery.find({ chatId: chat._id }).sort({ createdAt: 1 });
            const conversationHistory = previousQueries.map(q => ([
                { role: 'user', content: q.prompt },
                { role: 'assistant', content: q.response }
            ])).flat();

            const messages = [...conversationHistory, { role: 'user', content: `${prompt}${context}` }];

            const assistantResponse = await aiService.generateResponse(model, messages, systemPrompt);
            
            const newChatQuery = new ChatQuery({
                chatId: chat._id,
                prompt: prompt,
                model: model,
                systemPrompt: systemPrompt,
                webSearch: webSearch === 'true' || webSearch === true,
                response: assistantResponse
            });
            await newChatQuery.save();

            chat.updatedAt = Date.now();
            await chat.save();
            
            res.status(200).json({ chatId: chat._id, chatname: chat.chatname, response: assistantResponse });
        } catch (error) {
            console.error('Handle Chat Error:', error);
            res.status(500).json({ error: 'An internal server error occurred.' });
        }
    },

    // --- STREAMING METHODS ---
    createChatStream: async (req, res) => {
        try {
            const { clerkUserId, prompt, model, systemPrompt, webSearch } = req.body;
            const files = req.files;

            if (!clerkUserId || !prompt || !model) return res.status(400).json({ error: 'Missing required fields' });

            res.writeHead(200, {
                'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
                'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*',
            });

            const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

            sendEvent({ type: 'status', message: 'Initializing chat...' });

            let user = await User.findOne({ userId: clerkUserId });
            if (!user) {
                user = new User({ userId: clerkUserId, chats: [] });
                await user.save();
            }

            sendEvent({ type: 'status', message: 'Generating chat name...' });
            const chatname = await aiService.generateChatname(prompt);

            const chat = new Chat({ userId: user._id, title: prompt.substring(0, 50), chatname: chatname });
            await chat.save();
            user.chats.push(chat._id);
            await user.save();

            sendEvent({ type: 'metadata', chatId: chat._id, chatname: chat.chatname });

            let context = '';
            if (webSearch === 'true' || webSearch === true) {
                sendEvent({ type: 'status', message: 'Searching the web...' });
                context += await webSearchService.search(prompt);
                sendEvent({ type: 'status', message: 'Web search completed.' });
            }

            if (files && files.length > 0) {
                sendEvent({ type: 'status', message: `Processing ${files.length} file(s)...` });
                context += await ragService.getContextFromFiles(prompt, files);
                sendEvent({ type: 'status', message: 'File processing completed.' });
            }
            
            const augmentedPrompt = `${prompt}${context}`;
            const messages = [{ role: 'user', content: augmentedPrompt }];
            
            sendEvent({ type: 'status', message: 'Generating AI response...' });

            let fullResponse = '';
            try {
                for await (const chunk of aiService.generateStreamingResponse(model, messages, systemPrompt)) {
                    fullResponse += chunk;
                    sendEvent({ type: 'content', content: chunk });
                }
                
                const firstChatQuery = new ChatQuery({
                    chatId: chat._id, prompt, model, systemPrompt,
                    webSearch: webSearch === 'true' || webSearch === true,
                    response: fullResponse
                });
                await firstChatQuery.save();
                sendEvent({ type: 'complete', fullResponse });

            } catch (aiError) {
                console.error('AI generation error:', aiError);
                sendEvent({ type: 'error', error: `I apologize, an error occurred with the AI service: ${aiError.message}` });
            }

            res.write(`data: [DONE]\n\n`);
            res.end();

        } catch (error) {
            console.error('Streaming createChat error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'An internal server error occurred.' });
            } else {
                res.end();
            }
        }
    },

    handleChatStream: async (req, res) => {
        try {
            const { clerkUserId, prompt, model, systemPrompt, webSearch } = req.body;
            const { chatId } = req.params;
            const files = req.files;

            if (!clerkUserId || !prompt || !model || !chatId) return res.status(400).json({ error: 'Missing required fields' });

            res.writeHead(200, {
                'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
                'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*',
            });

            const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

            sendEvent({ type: 'status', message: 'Loading chat...' });

            const chat = await Chat.findById(chatId);
            if (!chat) {
                sendEvent({ type: 'error', error: 'Chat not found' });
                res.write(`data: [DONE]\n\n`);
                return res.end();
            }

            sendEvent({ type: 'metadata', chatId: chat._id, chatname: chat.chatname });
            
            sendEvent({ type: 'status', message: 'Loading conversation history...' });
            const previousQueries = await ChatQuery.find({ chatId: chat._id }).sort({ createdAt: 1 });

            let context = '';
            if (webSearch === 'true' || webSearch === true) {
                sendEvent({ type: 'status', message: 'Searching the web...' });
                context += await webSearchService.search(prompt);
                sendEvent({ type: 'status', message: 'Web search completed.' });
            }

            if (files && files.length > 0) {
                sendEvent({ type: 'status', message: `Processing ${files.length} file(s)...` });
                context += await ragService.getContextFromFiles(prompt, files);
                sendEvent({ type: 'status', message: 'File processing completed.' });
            }

            const conversationHistory = previousQueries.map(q => ([
                { role: 'user', content: q.prompt },
                { role: 'assistant', content: q.response }
            ])).flat();

            const messages = [...conversationHistory, { role: 'user', content: `${prompt}${context}` }];

            sendEvent({ type: 'status', message: 'Generating AI response...' });

            let fullResponse = '';
            try {
                for await (const chunk of aiService.generateStreamingResponse(model, messages, systemPrompt)) {
                    fullResponse += chunk;
                    sendEvent({ type: 'content', content: chunk });
                }

                const newChatQuery = new ChatQuery({
                    chatId: chat._id, prompt, model, systemPrompt,
                    webSearch: webSearch === 'true' || webSearch === true,
                    response: fullResponse
                });
                await newChatQuery.save();
                
                chat.updatedAt = Date.now();
                await chat.save();
                sendEvent({ type: 'complete', fullResponse });

            } catch (aiError) {
                console.error('AI generation error:', aiError);
                sendEvent({ type: 'error', error: `I apologize, an error occurred with the AI service: ${aiError.message}` });
            }

            res.write(`data: [DONE]\n\n`);
            res.end();

        } catch (error) {
            console.error('Streaming handleChat error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'An internal server error occurred.' });
            } else {
                res.end();
            }
        }
    },
   
    getUserChats: async (req, res) => {
        try {
            const { clerkUserId } = req.params;
            const user = await User.findOne({ userId: clerkUserId });
            if (!user) {
                const newUser = new User({ userId: clerkUserId, chats: [] });
                await newUser.save();
                return res.status(200).json([]);
            }
            const chats = await Chat.find({ _id: { $in: user.chats } }).sort({ updatedAt: -1 });
            res.status(200).json(chats);
        } catch (error) {
            res.status(500).json({ error: 'An internal server error occurred.' });
        }
    },

    getChatHistory: async (req, res) => {
        try {
            const { chatId } = req.params;
            const chat = await Chat.findById(chatId);
            if (!chat) {
                return res.status(404).json({ error: 'Chat not found' });
            }
            const chatQueries = await ChatQuery.find({ chatId: chat._id }).sort({ createdAt: 1 });
            res.status(200).json({
                chat: chat,
                chatQueries: chatQueries
            });
        } catch (error) {
            res.status(500).json({ error: 'An internal server error occurred.' });
        }
    },
    
    switchModel: async (req, res) => {
        try {
            const { clerkUserId, chatId, newModel, systemPrompt } = req.body;
            const chat = await Chat.findById(chatId);
            if (!chat) {
                return res.status(404).json({ error: 'Chat not found' });
            }
            const previousQueries = await ChatQuery.find({ chatId: chat._id }).sort({ createdAt: 1 });
            const lastQuery = previousQueries[previousQueries.length - 1];
            const oldModel = lastQuery ? lastQuery.model : 'no previous model';
            if (lastQuery && lastQuery.model === newModel) {
                return res.status(200).json({ message: 'Model is already set to ' + newModel, chat: chat });
            }
            let conversationSummary = 'Previous conversation context preserved.';
            if (previousQueries.length > 0) {
                try {
                    conversationSummary = await aiService.generateConversationSummary(previousQueries);
                } catch (summaryError) {
                    console.error('Summary generation error on model switch:', summaryError);
                }
            }
            const switchChatQuery = new ChatQuery({
                chatId: chat._id, prompt: `(System: Model switched from ${oldModel} to ${newModel})`,
                model: newModel, systemPrompt: systemPrompt,
                webSearch: false, response: conversationSummary
            });
            await switchChatQuery.save();
            chat.updatedAt = Date.now();
            await chat.save();
            res.status(200).json({ message: `Successfully switched from ${oldModel} to ${newModel}`, chat: chat });
        } catch (error) {
            console.error('Switch Model Error:', error);
            res.status(500).json({ error: 'An internal server error occurred.' });
        }
    },

    getAvailableModels: async (req, res) => {
        try {
            const models = [
                { modelName: "Claude 3.5 Sonnet", modelCategory: "Text Generation", description: "Fast and efficient text generation" },
                { modelName: "llama3-70b-8192", modelCategory: "Text Generation", description: "Powerful open-source model via Groq" },
                { modelName: "gpt-3.5-turbo", modelCategory: "Text Generation", description: "Reliable and versatile text generation" },
                { modelName: "gemini-1.5-flash", modelCategory: "Text Generation", description: "Google's advanced language model" },
                { modelName: "dall-e-3", modelCategory: "Image Generation", description: "High-quality image generation" }
            ];
            res.status(200).json(models);
        } catch (error) {
            res.status(500).json({ error: 'An internal server error occurred.' });
        }
    }
};

module.exports = chatController;