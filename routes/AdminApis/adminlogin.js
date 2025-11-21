const express = require("express");
const router = express.Router();
const pool = require("../../db"); // Database connection
const bcrypt = require("bcrypt");
const path = require("path");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../../cloudinary"); // ✅ your custom cloudinary config file
const multer = require("multer");

/* =========================================================
   1. Register Admin
========================================================= */

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "admin/profile_images", // ✅ folder in Cloudinary
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    public_id: (req, file) => {
      const nameWithoutExt = path.parse(file.originalname).name;
      return Date.now() + "-" + nameWithoutExt;
    },
  },
});

const upload = multer({ storage });

/* ======================================================
   Register Admin (with Cloudinary Image Upload)
====================================================== */
router.post("/register", upload.single("image"), async (req, res) => {
  try {
    const { name, email, password, confirm_password, joining_date, phone } = req.body;
    const file = req.file;

    // Basic validations
    if (!name || !email || !password || !confirm_password || !phone) {
      return res.status(400).json({ success: false, message: "All required fields must be filled" });
    }

    if (!file) {
      return res.status(400).json({ success: false, message: "Profile image is required" });
    }

    if (password !== confirm_password) {
      return res.status(400).json({ success: false, message: "Passwords do not match" });
    }

    // Check if email already exists
    const existing = await pool.query("SELECT * FROM admin WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Get image URL
    const imageUrl = file.path;

    // Format joining date
    const formattedDate = joining_date || new Date().toISOString().split("T")[0];

    // Insert admin into DB
    const result = await pool.query(
      `INSERT INTO admin 
        (name, email, password, joining_date, phone, status, created_at, image)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata', $7)
       RETURNING *`,
      [name, email, hashedPassword, formattedDate, phone, "pending", imageUrl]
    );

    res.status(201).json({
      success: true,
      message: "Admin registered successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Admin registration error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});



/* =========================================================
   2. Admin Login
========================================================= */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "All fields are required" });

  try {
    const result = await pool.query("SELECT * FROM admin WHERE email=$1", [email]);
    const admin = result.rows[0];

    if (!admin) return res.status(404).json({ error: "Admin not found" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

    // Successful login response
    res.json({
      success: true,
      admin,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   3. Forgot Password
========================================================= */
router.post("/forgot-password", async (req, res) => {
  const { email, new_password, confirm_password } = req.body;

  // 🧾 Validate input
  if (!email || !new_password || !confirm_password) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (new_password !== confirm_password) {
    return res.status(400).json({ error: "Passwords do not match" });
  }

  try {
    // Check if admin exists
    const result = await pool.query("SELECT * FROM admin WHERE email=$1", [email]);
    const admin = result.rows[0];

    if (!admin) return res.status(404).json({ error: "Admin not found" });

    // 🔒 Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update password in DB
    await pool.query("UPDATE admin SET password=$1 WHERE email=$2", [
      hashedPassword,
      email,
    ]);

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Server error" });
  }
});


/* =========================================================
   4. Get All Admins
========================================================= */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM admin ORDER BY id ASC");
    res.json({ success: true, admins: result.rows });
  } catch (error) {
    console.error("Error fetching admins:", error);
    res.status(500).json({ error: "Server error" });
  }
});/* =========================================================
   5. Get Admin by ID
========================================================= */
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("SELECT * FROM admin WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Admin not found" });
    }

    res.json({ success: true, admin: result.rows[0] });
  } catch (error) {
    console.error("Error fetching admin by ID:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   6. Update Admin by ID
========================================================= */
/* =========================================================
   6. Update Admin by ID (with optional password change)
========================================================= */
router.put("/update/:id", async (req, res) => {
  const { id } = req.params;
  const { name, email, joining_date, phone, password, confirm_password } = req.body;

  try {
    //  Check if admin exists
    const existingAdminQuery = await pool.query("SELECT * FROM admin WHERE id = $1", [id]);
    const existingAdmin = existingAdminQuery.rows[0];

    if (!existingAdmin) {
      return res.status(404).json({ error: "Admin not found" });
    }

    let updateQuery;
    let updateValues;

    //  If password fields are provided
    if (password && confirm_password) {
      if (password !== confirm_password) {
        return res.status(400).json({ error: "Passwords do not match" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      updateQuery = `
        UPDATE admin 
        SET name=$1, email=$2, joining_date=$3, phone=$4, password=$5 
        WHERE id=$6 
        RETURNING *`;

      //  Keep old joining_date if not provided
      updateValues = [
        name || existingAdmin.name,
        email || existingAdmin.email,
        joining_date || existingAdmin.joining_date,
        phone || existingAdmin.phone,
        hashedPassword,
        id,
      ];
    } else {
      //  If no password change
      updateQuery = `
        UPDATE admin 
        SET name=$1, email=$2, joining_date=$3, phone=$4 
        WHERE id=$5 
        RETURNING *`;

      //  Use old joining_date if new one isn’t sent
      updateValues = [
        name || existingAdmin.name,
        email || existingAdmin.email,
        joining_date || existingAdmin.joining_date,
        phone || existingAdmin.phone,
        id,
      ];
    }

    const result = await pool.query(updateQuery, updateValues);

    res.json({
      success: true,
      message: "Admin updated successfully",
      admin: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error updating admin:", error);
    res.status(500).json({ error: "Server error" });
  }
});



/* =========================================================
   7. Delete Admin by ID
========================================================= */
router.delete("/delete/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("DELETE FROM admin WHERE id=$1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Admin not found" });
    }

    res.json({ success: true, message: "Admin deleted successfully" });
  } catch (error) {
    console.error("Error deleting admin:", error);
    res.status(500).json({ error: "Server error" });
  }
});


module.exports = router;
