// routes/doctorRoutes.js
// routes/doctorRoutes.js
const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db");
const multer = require("multer"); // ✅ REQUIRED

const router = express.Router();

// PDF
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

// =======================
// MULTER CONFIG (VOICE UPLOAD)
// =======================
const upload = multer({
  storage: multer.memoryStorage(), // important for voice buffer
});

// =======================
// GOOGLE SPEECH + TRANSLATE (REQUIRED)
// =======================
const speech = require("@google-cloud/speech");
const { Translate } = require("@google-cloud/translate").v2;

const speechClient = new speech.SpeechClient();
const translateClient = new Translate();

const streamifier = require("streamifier");
const cloudinary = require("../cloudinary");
const uploadAudioToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "voice_recordings",
        resource_type: "video", // REQUIRED for audio
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(stream);
  });
};
function uploadPdfToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "prescriptions",
        resource_type: "raw", // REQUIRED for PDF
        format: "pdf",
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(stream);
  });
}
function generatePrescriptionPDF(data, filePath) {
  const doc = new PDFDocument();

  doc.pipe(fs.createWriteStream(filePath));

  // HOSPITAL HEADER
  doc.fontSize(18).text("🏥 Bharat Medical Hospital", { align: "center" });
  doc.fontSize(10).text("Andhra Pradesh, India", { align: "center" });
  doc.moveDown();

  doc.fontSize(14).text(`Dr. ${data.doctorName}`);
  doc.text(`Department: ${data.department || "General"}`);
  doc.text(`Doctor ID: ${data.doctorId}`);
  doc.text(`Reg No: ${data.registrationNumber || "N/A"}`);
  doc.moveDown();

  doc.text(`Patient ID: ${data.patientId}`);
  doc.text(`Patient Name: ${data.patientName || ""}`);
  doc.moveDown();

  doc.fontSize(14).text("Prescription:", { underline: true });
  doc.fontSize(12).text(data.translatedText);

  doc.end();
}
async function speechToText(audioBuffer) {
  const request = {
    audio: {
      content: audioBuffer.toString("base64"),
    },
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 16000,
      languageCode: "te-IN", // can change dynamically
    },
  };

  const [response] = await speechClient.recognize(request);

  return response.results
    .map((r) => r.alternatives[0].transcript)
    .join(" ");
}
async function translateToEnglish(text) {
  const [translation] = await translateClient.translate(text, "en");
  return translation;
}

const uploadImageToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "doctor_profiles",
        resource_type: "image",
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(stream);
  });
};
// -------------------
// Doctor Registration
// -------------------
router.post("/register", upload.single("profileImage"), async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      confirmPassword,
      phoneNumber,
      department,
      role,
      gender,
      experience,
      description,
      scheduleIn,
      scheduleOut,
    } = req.body;

    // =========================
    // VALIDATION
    // =========================
    if (
      !name ||
      !email ||
      !password ||
      !confirmPassword ||
      !phoneNumber ||
      !department ||
      !role ||
      !gender ||
      !experience ||
      !description ||
      !scheduleIn ||
      !scheduleOut
    ) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    // =========================
    // CHECK EXISTING DOCTOR
    // =========================
    const existingDoctor = await db.query(
      "SELECT * FROM doctors WHERE email=$1",
      [email]
    );

    if (existingDoctor.rows.length > 0) {
      return res.status(400).json({ error: "Doctor already exists" });
    }

    // =========================
    // HASH PASSWORD
    // =========================
    const hashedPassword = await bcrypt.hash(password, 10);

    // =========================
    // IMAGE UPLOAD (CLOUDINARY)
    // =========================
    let imageUrl = null;

    if (req.file && req.file.buffer) {
      try {
        const uploadResult = await uploadImageToCloudinary(req.file.buffer);
        imageUrl = uploadResult.secure_url;
      } catch (err) {
        console.error("Image upload failed:", err);
        return res.status(500).json({ error: "Image upload failed" });
      }
    }

    // =========================
    // INSERT DOCTOR
    // =========================
    const newDoctor = await db.query(
      `INSERT INTO doctors 
      (
        name,
        email,
        password,
        phone_number,
        department,
        role,
        gender,
        experience,
        description,
        schedule_in,
        schedule_out,
        status,
        profile_image
      )
      VALUES 
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12)
      RETURNING 
        id,
        name,
        email,
        phone_number,
        department,
        role,
        gender,
        experience,
        description,
        schedule_in,
        schedule_out,
        status,
        profile_image`,
      [
        name,
        email,
        hashedPassword,
        phoneNumber,
        department,
        role,
        gender,
        experience,
        description,
        scheduleIn,
        scheduleOut,
        imageUrl,
      ]
    );

    // =========================
    // RESPONSE
    // =========================
    res.status(201).json({
      message: "Doctor registered successfully",
      doctor: newDoctor.rows[0],
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------
// Doctor Login
// -------------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const doctor = await db.query("SELECT * FROM doctors WHERE email=$1", [email]);

    if (doctor.rows.length === 0) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const validPassword = await bcrypt.compare(password, doctor.rows[0].password);
    if (!validPassword) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    res.json({
      message: "Login successful",
      doctor: {
        id: doctor.rows[0].id,
        name: doctor.rows[0].name,
        email: doctor.rows[0].email,
        phoneNumber: doctor.rows[0].phone_number,
        department: doctor.rows[0].department,
        role: doctor.rows[0].role,
        gender: doctor.rows[0].gender,
        experience: doctor.rows[0].experience,
        description: doctor.rows[0].description,
        scheduleIn: doctor.rows[0].schedule_in,
        scheduleOut: doctor.rows[0].schedule_out,
        status:doctor.rows[0].status,
      },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------
// Forgot Password
// -------------------
router.post("/forgot-password", async (req, res) => {
  try {
    const { email, newPassword, confirmNewPassword } = req.body;

    if (!email || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    const doctor = await db.query("SELECT * FROM doctors WHERE email=$1", [email]);

    if (doctor.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found with this email" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(
      "UPDATE doctors SET password=$1 WHERE email=$2",
      [hashedPassword, email]
    );

    res.json({ message: "Password updated successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------
// Get All Doctors
// -------------------
router.get("/all", async (req, res) => {
  try {
    const doctors = await db.query(
      `SELECT 
        id, name, email, phone_number, department, role, gender,profile_image, 
        experience, description, schedule_in, schedule_out,status
       FROM doctors`
    );

    res.json(doctors.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------
// Get Doctor by ID
// -------------------
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const doctor = await db.query(
      `SELECT 
        id, name, email, phone_number, department, role, gender, 
        experience, description, schedule_in, schedule_out 
       FROM doctors WHERE id=$1`,
      [id]
    );

    if (doctor.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    res.json(doctor.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------
// Update Doctor
// -------------------
router.put("/update/:id", upload.single("profileImage"), async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      email,
      phoneNumber,
      department,
      role,
      gender,
      experience,
      description,
      scheduleIn,
      scheduleOut,
      password
    } = req.body;

    const doctor = await db.query("SELECT * FROM doctors WHERE id=$1", [id]);

    if (doctor.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    // ✅ Password handling
    let hashedPassword = doctor.rows[0].password;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // ✅ Image handling
    let profileImage = doctor.rows[0].profile_image; // existing image

    if (req.file) {
      profileImage = req.file.filename; // new uploaded image
    }

    const updatedDoctor = await db.query(
      `UPDATE doctors SET 
        name=$1, email=$2, phone_number=$3, department=$4, role=$5, gender=$6,
        experience=$7, description=$8, schedule_in=$9, schedule_out=$10, 
        password=$11, profile_image=$12
       WHERE id=$13
       RETURNING 
        id, name, email, phone_number, department, role, gender, 
        experience, description, schedule_in, schedule_out, profile_image`,
      [
        name,
        email,
        phoneNumber,
        department,
        role,
        gender,
        experience,
        description,
        scheduleIn,
        scheduleOut,
        hashedPassword,
        profileImage,
        id
      ]
    );

    res.json({
      message: "Doctor updated successfully",
      doctor: updatedDoctor.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------
// Delete Doctor
// -------------------
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const doctor = await db.query("SELECT * FROM doctors WHERE id=$1", [id]);
    if (doctor.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    await db.query("DELETE FROM doctors WHERE id=$1", [id]);

    res.json({ message: "Doctor deleted successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------------------
// Appointment Summary (Daily/Weekly/Monthly)
// -------------------------------
router.get("/appointments/summary/:doctorId", async (req, res) => {
  try {
    const { doctorId } = req.params;

    const query = `
      SELECT
        (
          SELECT COUNT(*) 
          FROM (
            SELECT appointment_date AS appt_date 
            FROM doctorbooking WHERE doctor_id::text = $1
            UNION ALL
            SELECT date AS appt_date 
            FROM appointments WHERE doctorid::text = $1
          ) all_appointments
          WHERE all_appointments.appt_date >= date_trunc('week', CURRENT_DATE)
        ) AS weekly_appointments,

        (
          SELECT COUNT(*) 
          FROM (
            SELECT appointment_date AS appt_date 
            FROM doctorbooking WHERE doctor_id::text = $1
            UNION ALL
            SELECT date AS appt_date 
            FROM appointments WHERE doctorid::text = $1
          ) all_appointments
          WHERE all_appointments.appt_date >= date_trunc('month', CURRENT_DATE)
        ) AS monthly_appointments,

        (
          SELECT COUNT(*) 
          FROM (
            SELECT appointment_date AS appt_date 
            FROM doctorbooking WHERE doctor_id::text = $1
            UNION ALL
            SELECT date AS appt_date 
            FROM appointments WHERE doctorid::text = $1
          ) all_appointments
        ) AS total_appointments
    `;

    const result = await db.query(query, [doctorId]);

    res.json({
      success: true,
      doctorId,
      summary: result.rows[0],
    });

  } catch (error) {
    console.error("Error fetching doctor summary:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/assign-doctor", async (req, res) => {
  const { nurseId, doctorIds } = req.body;

  if (!nurseId || !doctorIds || !Array.isArray(doctorIds) || doctorIds.length === 0) {
    return res.status(400).json({ message: "Missing nurseId or doctorIds" });
  }

  try {
    const result = await db.query(
      `UPDATE employees
       SET assigned_doctor = $1
       WHERE id = $2 AND role = 'pune'
       RETURNING *`,
      [doctorIds, nurseId] // doctorIds is an array
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Nurse not found or not a nurse" });
    }

    res.json({
      success: true,
      message: "Doctors assigned successfully",
      nurse: result.rows[0],
    });
  } catch (error) {
    console.error("Assign Doctor Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});



// GET NURSE → ASSIGNED DOCTOR DETAILS
router.get("/nurse/assigned-doctor/:id", async (req, res) => {
  const nurseId = req.params.id;

  try {
    // First get the nurse and assigned_doctor array
    const nurseResult = await db.query(
      `SELECT id, full_name, assigned_doctor
       FROM employees
       WHERE id = $1 AND role = 'pune'`,
      [nurseId]
    );

    if (nurseResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Nurse not found" });
    }

    const nurse = nurseResult.rows[0];

    if (!nurse.assigned_doctor || nurse.assigned_doctor.length === 0) {
      return res.json({ success: false, message: "No doctors assigned" });
    }

    // Get doctor details for all assigned doctor IDs
    const doctorsResult = await db.query(
      `SELECT id, name, department, phone_number, email
       FROM doctors
       WHERE id = ANY($1)`,
      [nurse.assigned_doctor]
    );

    return res.json({
      success: true,
      nurse: { id: nurse.id, name: nurse.full_name },
      doctors: doctorsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


router.get("/employees/nurses", async (req, res) => {
  const result = await db.query(
    "SELECT id, full_name FROM employees WHERE role = 'pune'"
  );
  res.json(result.rows);
});
router.get("/employees/doctors", async (req, res) => {
  const result = await db.query(
    "SELECT id, name, department FROM doctors"
  );
  res.json(result.rows);
});

router.put("/update-status/:id", async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  try {
    // Validate status
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    const query = `UPDATE doctors SET status = $1 WHERE id = $2 RETURNING *`;
    const result = await db.query(query, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    res.json({
      message: `Doctor ${status} successfully`,
      doctor: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
router.post("/voice-prescription", upload.single("audio"), async (req, res) => {
  try {
    const {
      doctorId,
      patientId,
      doctorName,
      patientName,
      department,
    } = req.body;

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Audio file missing" });
    }

    // =========================
    // 1. Upload AUDIO to Cloudinary
    // =========================
    let audioUrl;
    try {
      const audioResult = await uploadAudioToCloudinary(req.file.buffer);
      audioUrl = audioResult.secure_url;
    } catch (err) {
      console.error("Audio upload failed:", err);
      return res.status(500).json({ error: "Audio upload failed" });
    }

    // =========================
    // 2. Speech to Text
    // =========================
    const originalText = await speechToText(req.file.buffer);

    // =========================
    // 3. Translate
    // =========================
    const translatedText = await translateToEnglish(originalText);

    // =========================
    // 4. Create PDF
    // =========================
    const doc = new PDFDocument();
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));

    doc.on("end", async () => {
      try {
        const pdfBuffer = Buffer.concat(buffers);

        const pdfResult = await uploadPdfToCloudinary(pdfBuffer);
        const pdfUrl = pdfResult.secure_url;

        // =========================
        // 5. SAVE TO DATABASE
        // =========================
        await db.query(
          `INSERT INTO prescriptions 
          (
            doctor_id,
            patient_id,
            doctor_name,
            patient_name,
            department,
            audio_url,
            original_text,
            translated_text,
            pdf_url
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            doctorId,
            patientId,
            doctorName,
            patientName,
            department,
            audioUrl,
            originalText,
            translatedText,
            pdfUrl,
          ]
        );

        return res.json({
          success: true,
          message: "Prescription generated successfully",
          audioUrl,
          pdfUrl,
          originalText,
          translatedText,
        });
      } catch (err) {
        console.error("PDF/DB error:", err);
      }
    });

    // =========================
    // 6. PDF CONTENT
    // =========================
    doc.fontSize(18).text("🏥 Bharat Medical Hospital", { align: "center" });
    doc.fontSize(10).text("Andhra Pradesh, India", { align: "center" });
    doc.moveDown();

    doc.text(`Doctor: Dr. ${doctorName}`);
    doc.text(`Department: ${department || "General"}`);
    doc.text(`Doctor ID: ${doctorId}`);
    doc.moveDown();

    doc.text(`Patient ID: ${patientId}`);
    doc.text(`Patient Name: ${patientName || "N/A"}`);
    doc.moveDown();

    doc.fontSize(14).text("Prescription:");
    doc.text(translatedText);

    doc.end();
  } catch (err) {
    console.error("❌ Voice Prescription Error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
