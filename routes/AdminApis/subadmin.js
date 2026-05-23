const express = require("express");
const bcrypt = require("bcrypt");
const path = require("path");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../../cloudinary"); // ✅ your custom cloudinary config file
const pool = require("../../db");
const { Parser } = require("json2csv");
const ExcelJS = require("exceljs");
const router = express.Router();

/* ======================================================
    Cloudinary + Multer Config
====================================================== */
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "subadmin/profile_images", // ✅ folder in Cloudinary
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    public_id: (req, file) => {
      const nameWithoutExt = path.parse(file.originalname).name;
      return Date.now() + "-" + nameWithoutExt;
    },
  },
});

const upload = multer({ storage });

/* ======================================================
   1️ Register Subadmin (with Cloudinary Image Upload)
====================================================== */

router.get("/export", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, 
        name, 
        email, 
        phone, 
        joining_date, 
        status 
      FROM subadmin
      ORDER BY id ASC
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No SubAdmins found" });
    }

    // ===== Add helper function =====
    const formatPhone = (num) => {
      if (!num) return "";
      let cleaned = ("" + num).replace(/\D/g, ""); // remove non-digit characters
      if (cleaned.length === 10) return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
      return num; // return as-is if not 10 digits
    };

    // ===== CSV Fields with formatted phone =====
    const fields = [
      { label: "ID", value: "id" },
      { label: "Name", value: "name" },
      { label: "Email", value: "email" },
      { label: "Phone", value: row => `"${formatPhone(row.phone)}"` }, // formatted phone wrapped in quotes
      { label: "Joining Date", value: "joining_date" },
      { label: "Status", value: "status" }
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(result.rows);

    // File name
    const fileName = `subadmins_${Date.now()}.csv`;

    // Send CSV File
    res.header("Content-Type", "text/csv");
    res.attachment(fileName);
    return res.send(csv);

  } catch (error) {
    console.error("CSV Export Error:", error);
    res.status(500).json({ message: "Failed to export CSV" });
  }
});

router.post("/register", upload.single("image"), async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      cnfpass,
      joiningdate,
      phone,
      department,
    } = req.body;

    const file = req.file;

    if (
      !name ||
      !email ||
      !password ||
      !cnfpass ||
      !phone ||
      !department
    ) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled",
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "Profile image is required",
      });
    }

    if (password !== cnfpass) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    const existing = await pool.query(
      "SELECT * FROM subadmin WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const imageUrl = file.path;

    const formattedDate =
      joiningdate || new Date().toISOString().split("T")[0];

    const result = await pool.query(
      `INSERT INTO subadmin 
        (
          name,
          email,
          password,
          confirm_password,
          joining_date,
          phone,
          department,
          status,
          created_at,
          image
        )
       VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
          $9
       )
       RETURNING *`,
      [
        name,
        email,
        hashedPassword,
        hashedPassword,
        formattedDate || new Date(),
        phone,
        department,
        "pending",
        imageUrl,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Subadmin registered successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Subadmin registration error:", error.message);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});





/* ======================================================
   2. Login Subadmin
====================================================== */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query("SELECT * FROM subadmin WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid email or password" });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid email or password" });
    }

    if (user.status !== 'approved') {
      return res.status(403).json({ 
        success: false, 
        message: `Your account is currently '${user.status}'. Please wait for admin approval.` 
      });
    }

    res.status(200).json({ success: true, message: "Login successful", user });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


/* ======================================================
    3.Forgot Password
====================================================== */
router.put("/forgot-password", async (req, res) => {
  try {
    const { email, newpassword, confirmnewpassword } = req.body;

    // 1️ Check all fields present
    if (!email || !newpassword || !confirmnewpassword) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    // 2️ Check passwords match
    if (newpassword !== confirmnewpassword) {
      return res.status(400).json({ success: false, message: "Passwords do not match" });
    }

    // 3️ Find subadmin by email
    const userResult = await pool.query("SELECT * FROM subadmin WHERE email = $1", [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Subadmin not found" });
    }

    // 4️ Hash new password
    const hashedPassword = await bcrypt.hash(newpassword, 10);

    // 5️ Update in database
    await pool.query(
      `UPDATE subadmin 
       SET password = $1, confirm_password = $1 
       WHERE email = $2`,
      [hashedPassword, email]
    );

    res.status(200).json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ======================================================
   4. Get All Subadmins
====================================================== */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, email, phone, joining_date, status, department, created_at FROM subadmin ORDER BY created_at DESC");

    res.status(200).json({ 
      success: true, 
      message: "All subadmins fetched successfully", 
      data: result.rows 
    });
  } catch (error) {
    console.error("Error fetching subadmins:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
/* ======================================================
   5. Get Subadmin by ID
====================================================== */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("SELECT * FROM subadmin WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Subadmin not found" });
    }

    res.status(200).json({
      success: true,
      message: "Subadmin fetched successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error fetching subadmin by ID:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.get("/employees/by-subadmin/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Get subadmin department
    const subadminRes = await pool.query(
      "SELECT department FROM subadmin WHERE id = $1",
      [id]
    );

    if (subadminRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subadmin not found",
      });
    }

    const department = subadminRes.rows[0].department;

    // 2. Get employees with same department
    const employeesRes = await pool.query(
      `SELECT * FROM employee WHERE LOWER(department) = LOWER($1)`,
      [department]
    );

    res.json({
      success: true,
      department,
      employees: employeesRes.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});
/* ======================================================
   6. Update Subadmin
====================================================== */
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      email,
      phone,
      joining_date,
      password,
      confirm_password,
      status,
      department,
    } = req.body;

    // Check if subadmin exists
    const existing = await pool.query(
      "SELECT * FROM subadmin WHERE id = $1",
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subadmin not found",
      });
    }

    let updateQuery;
    let updateValues;

    // ✅ Update with password
    if (password && confirm_password) {
      if (password !== confirm_password) {
        return res.status(400).json({
          success: false,
          message: "Passwords do not match",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      updateQuery = `
        UPDATE subadmin 
        SET 
          name = $1,
          email = $2,
          phone = $3,
          joining_date = $4,
          password = $5,
          confirm_password = $6,
          status = $7,
          department = $8
        WHERE id = $9
        RETURNING *`;

      updateValues = [
        name,
        email,
        phone,
        joining_date,
        hashedPassword,
        hashedPassword,
        status,
        department,
        id,
      ];
    } 
    
    // ✅ Update without password
    else {
      updateQuery = `
        UPDATE subadmin 
        SET 
          name = $1,
          email = $2,
          phone = $3,
          joining_date = $4,
          status = $5,
          department = $6
        WHERE id = $7
        RETURNING *`;

      updateValues = [
        name,
        email,
        phone,
        joining_date,
        status,
        department,
        id,
      ];
    }

    const result = await pool.query(updateQuery, updateValues);

    res.status(200).json({
      success: true,
      message: password
        ? "Subadmin & password updated successfully"
        : "Subadmin updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating subadmin:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* ======================================================
   7. Delete Subadmin
====================================================== */
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("DELETE FROM subadmin WHERE id = $1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Subadmin not found" });
    }

    res.status(200).json({
      success: true,
      message: "Subadmin deleted successfully",
      deleted: result.rows[0],
    });
  } catch (error) {
    console.error("Error deleting subadmin:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


router.put("/update-status", async (req, res) => {
  try {
    const {id, status } = req.body; // 'approved' or 'rejected'

    const result = await pool.query(
      "UPDATE subadmin SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Subadmin not found" });
    }

    res.status(200).json({ success: true, message: `Status updated to ${status}`, data: result.rows[0] });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
