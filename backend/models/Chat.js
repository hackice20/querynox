const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'New Chat' },
  chatname: { type: String, required: true }, // set only at creation, never changes
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Chat', ChatSchema); 