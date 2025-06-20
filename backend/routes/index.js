const express = require('express');
const multer = require('multer');
const chatController = require('../controllers/chatController');

const router = express.Router();

// Multer setup for handling file uploads (PDFs & images) in memory
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Chat routes
router.post('/chat', upload.array('files', 5), chatController.handleChat);
router.get('/chats/user/:clerkUserId', chatController.getUserChats);
router.get('/chat/:chatId', chatController.getChatHistory);

module.exports = router; 