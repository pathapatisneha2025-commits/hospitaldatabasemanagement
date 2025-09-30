const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken"); // 👈 for login tokens
const pool = require("../../db");
const multer = require("multer");
const path = require("path");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../../cloudinary");

const router = express.Router();

// Cloudinary multer config
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "delivery_boys", // Cloudinary folder
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    public_id: (req, file) => {
      const nameWithoutExt = path.parse(file.originalname).name;
      return Date.now() + "-" + nameWithoutExt;
    },
  },
});

const upload = multer({ storage });

// ---------------- REGISTER ----------------
router.post(
  "/register",
  upload.fields([{ name: "profile_pic" }, { name: "bike_photo" }]),
  async (req, res) => {
    const { name, phone, email, address, bike_number, password, confirmPassword } = req.body;

    // 1️⃣ Validate passwords
    if (!password || !confirmPassword) {
      return res.status(400).json({ error: "Password and confirm password are required" });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    // 2️⃣ Cloudinary URLs
    const profilePicUrl = req.files?.profile_pic?.[0]?.path || null;
    const bikePhotoUrl = req.files?.bike_photo?.[0]?.path || null;

    try {
      // 3️⃣ Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // 4️⃣ Insert into DB
      const result = await pool.query(
        `INSERT INTO delivery_boys 
        (name, phone, email, address, profile_pic, bike_number, bike_photo, password, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'available')
         RETURNING id, name, phone, email, address, profile_pic, bike_number, bike_photo, status`,
        [
          name,
          phone,
          email,
          address,
          profilePicUrl,
          bike_number,
          bikePhotoUrl,
          hashedPassword,
        ]
      );

      res.status(201).json({ message: "Registration successful", deliveryBoy: result.rows[0] });
    } catch (err) {
      console.error("Error registering delivery boy:", err);
      res.status(500).json({ error: "Failed to register delivery boy" });
    }
  }
);

// ---------------- LOGIN ----------------
// ---------------- LOGIN ----------------
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1️⃣ Find user by email
    const result = await pool.query(
      "SELECT * FROM delivery_boys WHERE email = $1",
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

    // 2️⃣ Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // 3️⃣ Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "7d" }
    );

    // 4️⃣ Return user info (excluding password)
    const { password: _, ...userData } = user;

    res.json({ message: "Login successful", token, user: userData });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Failed to login" });
  }
});


module.exports = router;
