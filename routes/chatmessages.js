const express = require("express");
const router = express.Router();
const pool = require("../db");

const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "chat_images",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    public_id: (req, file) =>
      Date.now() + "-" + file.originalname.split(".")[0],
  },
});

const upload = multer({ storage });

/* =========================
   GET ALL MESSAGES
   (Employee ↔ Admin + Employee ↔ Employee)
========================= */

router.get("/messages/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM messages ORDER BY created_at DESC"
    );

    res.json({ success: true, messages: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================
   SEND MESSAGE
   (text + image upload)
========================= */

router.post("/messages/add", upload.single("image"), async (req, res) => {
  try {
    const { senderId, receiverId, text, senderName } = req.body;

    let imageUrl = null;

    if (req.file) {
      imageUrl = req.file.path;
    }

    const result = await pool.query(
      `INSERT INTO messages 
      (sender_id, sender_name, receiver_id, text, image)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [senderId, senderName, receiverId || null, text, imageUrl]
    );

    res.json({ success: true, message: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================
   GET CHAT BETWEEN TWO USERS
   (Employee ↔ Employee OR Admin)
========================= */

router.get("/messages/:user1/:user2", async (req, res) => {
  try {
    const { user1, user2 } = req.params;

    const result = await pool.query(
      `SELECT * FROM messages
       WHERE (sender_id = $1 AND receiver_id = $2)
          OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY created_at ASC`,
      [user1, user2]
    );

    res.json({ success: true, messages: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;