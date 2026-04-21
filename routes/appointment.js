const express = require('express');
const router = express.Router();
const db = require('../db'); // PostgreSQL client (from db.js)
const SendEmail = require("../utils/SenEmail");
const QRCode = require("qrcode"); // ✅ MUST IMPORT
const cron = require("node-cron");

const { Parser } = require("json2csv");
const ExcelJS = require("exceljs");

router.get("/export", async (req, res) => {
  try {
    const query = `
      SELECT 
        'Online' AS type,
        a.tokenid AS id,
        a.name AS patient_name,
        a.age,
        a.gender,
        a.bloodgroup,
        a.doctorname,
        a.department,
        a.date,
        a.timeslot,
        a.consultantfees,
        a.reason,
        a.patientphone,
        a.paymentstatus
      FROM appointments a

      UNION ALL

      SELECT
        'Offline' AS type,
        d.daily_id AS id,
        d.patient_name,
        d.patient_age AS age,
        d.patient_gender AS gender,
        d.patient_blood_group AS bloodgroup,
        d.doctor_name AS doctorname,
        d.specialization AS department,
        d.appointment_date AS date,
        d.appointment_time AS timeslot,
        d.doctor_consultant_fee AS consultantfees,
        d.doctor_description AS reason,
        d.patient_phone,
        d.status AS paymentstatus
      FROM doctorbooking d

      ORDER BY date ASC;
    `;

    const result = await db.query(query);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No appointments found" });
    }
 const formatPhone = (num) => {
      if (!num) return "";
      let cleaned = ("" + num).replace(/\D/g, ""); // remove non-digits
      if (cleaned.length === 10) return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"); // format 10-digit
      return num; // return as-is if not 10 digits
    };

    const fields = [
      { label: "Type", value: "type" },
      { label: "Appointment ID", value: "id" },
      { label: "Patient Name", value: "patient_name" },
      { label: "Age", value: "age" },
      { label: "Gender", value: "gender" },
      { label: "Blood Group", value: "bloodgroup" },
      { label: "Doctor Name", value: "doctorname" },
      { label: "Department", value: "department" },
      { label: "Date", value: "date" },
      { label: "Time Slot", value: "timeslot" },
      { label: "Consultant Fees", value: "consultantfees" },
      { label: "Reason", value: "reason" },
      { label: "Phone",  value: row => `"${formatPhone(row.patientphone)}"`},
      { label: "Payment Status", value: "paymentstatus" },
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(result.rows);

    const fileName = `appointments_${Date.now()}.csv`;

    res.header("Content-Type", "text/csv");
    res.attachment(fileName);
    return res.send(csv);

  } catch (error) {
    console.error("CSV Export Error:", error);
    res.status(500).json({ message: "Failed to export appointments CSV" });
  }
});


// -------------------- CREATE (POST) --------------------
router.post("/add", async (req, res) => {
  const {
    doctorId,
    doctorName,
    experience,
    department,
    consultantFees,
    date,
    timeSlot,
    patientId,
    name,
    age,
    gender,
    bloodGroup,
    reason,
    patientPhone,
      patientEmail  , // ✅ ADD THIS

    doctorEmail, // 👈 include this to fetch visit limit
  } = req.body;

  try {
    // 🗓️ Normalize the date format (to YYYY-MM-DD)
    const formattedDate = date.includes("T") ? date.split("T")[0] : date;

    

    // ✅ Verify doctor exists
    const doctorCheckQuery = `SELECT doctor_id FROM  doctor_consultant_fees WHERE doctor_id = $1`;
    const doctorCheck = await db.query(doctorCheckQuery, [doctorId]);
    if (doctorCheck.rows.length === 0) {
      return res.status(404).json({ error: "Doctor ID not found in doctor_fees" });
    }

    // ✅ Prevent double booking
    const existing = await db.query(
      `SELECT * FROM appointments 
       WHERE doctorid = $1 AND date = $2 AND timeslot = $3`,
      [doctorId, formattedDate, timeSlot]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: "This time slot is already booked for the selected doctor.",
      });
    }

   // ✅ Fetch doctor's static daily limit (applies every day)
const visitData = await db.query(
  `SELECT number_of_visits_per_day 
   FROM doctor_visits 
   WHERE LOWER(doctor_email) = LOWER($1)
   LIMIT 1`,
  [doctorEmail]
);

console.log("📊 Visit Limit Found:", visitData.rows);

if (visitData.rows.length === 0) {
  return res.status(400).json({
    error: `No visit limit set for Dr. ${doctorName}`,
  });
}

const MAX_APPOINTMENTS_PER_DOCTOR_PER_DAY = parseInt(
  visitData.rows[0].number_of_visits_per_day,
  10
);


   const lastToken = await db.query(
  `
  SELECT MAX(tokenid) AS last_token
  FROM (
    SELECT tokenid 
    FROM appointments 
    WHERE doctorid = $1 AND date::date = TO_DATE($2, 'YYYY-MM-DD')
    
    UNION ALL
    
    SELECT daily_id AS tokenid 
    FROM doctorbooking 
    WHERE doctor_id::integer = $1 AND appointment_date::date = TO_DATE($2, 'YYYY-MM-DD')
  ) AS combined;
  `,
  [doctorId, formattedDate]
);
const reserveData = await db.query(
  `SELECT reserved_count 
   FROM reserve_rules
   WHERE doctor_id = $1 
   AND date::date = TO_DATE($2, 'YYYY-MM-DD')
   LIMIT 1`,
  [doctorId,formattedDate]   // ✅ FIXED HERE
);

const reservedCount = reserveData.rows.length > 0
  ? parseInt(reserveData.rows[0].reserved_count, 10)
  : 0;

let nextTokenId;

const last = lastToken.rows[0]?.last_token;

// If no previous tokens
if (!last) {
  nextTokenId = reservedCount + 1;
} else {
  const lastNumber = parseInt(last, 10);

  // IMPORTANT FIX:
  // if last token is already below reserved range → start after reserved
  if (lastNumber < reservedCount) {
    nextTokenId = reservedCount + 1;
  } else {
    nextTokenId = lastNumber + 1;
  }
}


    // ✅ Enforce daily limit
    if (nextTokenId > MAX_APPOINTMENTS_PER_DOCTOR_PER_DAY) {
      return res.status(200).json({
        alert: true,
        message: `No bookings available for Dr. ${doctorName} today.`,
      });
    }
// ✅ CREATE QR DATA FIRST
const qrData = JSON.stringify({
  token: nextTokenId,
  patientId,
  doctorId,
  date: formattedDate,
  time: timeSlot,
});
    // ✅ Insert appointment
  const insertQuery = `
INSERT INTO appointments
(tokenid, doctorid, doctorname, yearsofexperience, department, date, timeslot, consultantfees,
 paymentstatus, status, patientid, name, age, gender, bloodgroup, reason, patientphone, patientemail, qrdata, createdat)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
        'pending', 'pending',
        $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
RETURNING *;
`;

    const values = [
      nextTokenId,
      doctorId,
      doctorName,
      experience,
      department,
      formattedDate,
      timeSlot,
      consultantFees,
      patientId,
      name,
      age,
      gender,
      bloodGroup,
      reason,
      patientPhone,
        patientEmail,   // ✅ ADD THIS
  qrData // ✅ NOW STORED

    ];

const result = await db.query(insertQuery, values);
      // =========================
    // 📧 SEND EMAIL AFTER BOOKING
    // =========================


const qrImage = await QRCode.toDataURL(qrData, {
  width: 300,
});


    // convert to CID image

    // ================= HOSPITAL LOGO =================
    const HOSPITAL_LOGO =
      "https://hospitaldatabasemanagement.onrender.com/assets/Logo.jpg";

    // ================= EMAIL =================
    try {
      if (patientEmail) {
        await SendEmail({
          to: patientEmail,
          subject: `Appointment Confirmed - Dr. ${doctorName}`,
         attachments: [
  {
    filename: "qr.png",
    content: Buffer.from(qrImage.split("base64,")[1], "base64"),
    cid: "qrimage",
  },
],
          html: `
            <div style="font-family: Arial; text-align:center; padding:15px;">

              <img src="${HOSPITAL_LOGO}" style="width:120px;margin-bottom:10px"/>

              <h2>✅ Appointment Confirmed</h2>

              <p>Dear ${name},</p>

              <h3>👨‍⚕️ Doctor Details</h3>
              <p><b>Dr:</b> ${doctorName}</p>
              <p><b>Department:</b> ${department}</p>
              <p><b>Experience:</b> ${experience} years</p>

              <h3>📅 Appointment Details</h3>
              <p><b>Date:</b> ${formattedDate}</p>
              <p><b>Time:</b> ${timeSlot}</p>
<p style="font-size:16px; margin:10px 0;">
  <b>🎟️ Token Number:</b> 
  <span style="color:#d9534f; font-size:18px; font-weight:bold;">
    ${nextTokenId}
  </span>
</p>
              <hr/>

           <h3>📱 Scan QR at Hospital</h3>

<img src="cid:qrimage" width="180" /><p style="color:gray;font-size:12px">

  Show this QR at reception
</p>

<p style="margin-top:10px;color:#333;font-size:14px">
  📌 Please arrive 10–15 minutes before your appointment.
</p>

<p style="margin-top:5px;color:#333;font-size:14px">
  🙏 Thank you for choosing our hospital. Wishing you good health!
</p>
            </div>
          `,
        });
      }
    } catch (err) {
      console.error("Email error:", err.message);
    }

    // ================= RESPONSE =================
 return res.status(201).json({
  message: "Appointment booked successfully",
  appointment: result.rows[0],
  qrCode: qrImage, // ✅ correct
});
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

 

router.get("/scan-appointment", async (req, res) => {
  const { tokenid, patientid, doctorid } = req.query;

  if (!tokenid || !patientid || !doctorid) {
    return res.status(400).send("Missing parameters");
  }

  try {
    const result = await db.query(
      `UPDATE appointments
       SET status = 'available'
       WHERE tokenid = $1 
       AND patientid = $2 
       AND doctorid = $3`,
      [tokenid, patientid, doctorid]
    );

    if (result.rowCount === 0) {
      return res.send(`
        <h2>⚠️ No matching appointment found</h2>
      `);
    }

    return res.send(`
      <div style="text-align:center;font-family:sans-serif;padding:20px">
        <h2 style="color:green">✅ Appointment Marked as Available</h2>
        <p>QR scan successful ✔</p>
      </div>
    `);

  } catch (err) {
    console.log("Scan error:", err);
    res.status(500).send("Server error");
  }
});

router.put("/postpone", async (req, res) => {
  const {
    tokenid,
    daily_id,
    doctorid,
    patientid,
    newDate,
    newTime,
    reason
  } = req.body;

  console.log("📦 Postpone Request:", req.body);

  if (!newDate || !newTime) {
    return res.status(400).json({ error: "newDate and newTime are required" });
  }

  try {
    let updated;

    // =========================
    // 1. UPDATE APPOINTMENTS
    // =========================
    if (tokenid) {
      updated = await db.query(
        `UPDATE appointments
         SET date = $1,
             timeslot = $2,
             status = 'rescheduled'
         WHERE tokenid = $3 AND doctorid = $4
         RETURNING *`,
        [newDate, newTime, tokenid, doctorid]
      );
    }

    // =========================
    // 2. UPDATE DOCTOR BOOKING
    // =========================
    else if (daily_id) {
      updated = await db.query(
        `UPDATE doctorbooking
         SET appointment_date = $1,
             appointment_time = $2,
             status = 'rescheduled'
         WHERE daily_id = $3 AND doctor_id = $4
         RETURNING *`,
        [newDate, newTime, daily_id, doctorid]
      );
    } else {
      return res.status(400).json({ error: "tokenid or daily_id required" });
    }

    if (!updated || updated.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const appointment = updated.rows[0];

    // =========================
    // 3. GET PATIENT DETAILS
    // =========================
    const patientRes = await db.query(
      `SELECT name, email FROM patients WHERE id = $1`,
      [patientid]
    );

    if (patientRes.rows.length === 0) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const patient = patientRes.rows[0];

    // =========================
    // 4. SEND EMAIL
    // =========================
    await SendEmail({
      to: patient.email,   // ✅ FIXED HERE
      subject: "📅 Appointment Rescheduled",
      html: `
        <div style="font-family:Arial;padding:20px;background:#f9fafb;border-radius:10px">

          <h2 style="color:#ef4444">⚠️ Appointment Rescheduled</h2>

          <p>Dear <b>${patient.name}</b>,</p>

          <p>Your appointment has been <b>rescheduled by hospital staff</b>.</p>

          <div style="background:#fff;padding:15px;border-radius:8px;margin-top:10px">
            <h3>📅 New Schedule</h3>
            <p><b>Date:</b> ${newDate}</p>
            <p><b>Time:</b> ${newTime}</p>
            ${reason ? `<p><b>Reason:</b> ${reason}</p>` : ""}
          </div>

          <hr/>

          <p style="color:#555">
            ⚠️ Please arrive 10–15 minutes before your appointment time.
          </p>

          <p style="color:green;font-weight:bold">
            Thank you for choosing our hospital ❤️
          </p>

        </div>
      `,
    });

    return res.json({
      success: true,
      message: "Appointment postponed successfully",
      data: appointment,
    });

  } catch (err) {
    console.error("❌ Postpone Error:", err);
    return res.status(500).json({
      error: "Server error while rescheduling appointment",
    });
  }
});
router.post('/patient/add', async (req, res) => {
  try {
    const {
      patientId,  // frontend must provide this
      fullName,
      age,
      gender,
      phone,
      email,
      bloodGroup,
      city,
      pin,
      parentName,
    } = req.body;

    // Validate required fields
    if (!patientId || !fullName || !age || !phone || !gender) {
      return res.status(400).json({ message: 'patientId, fullName, age, phone, and gender are required.' });
    }

    const query = `
      INSERT INTO patient_detailed_form
      (patient_id, full_name, age, gender, phone, email, blood_group, city, pin, parent_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *;
    `;

    const values = [patientId, fullName, age, gender, phone, email, bloodGroup, city, pin, parentName];

    const result = await db.query(query, values);

    res.status(201).json({ message: 'Patient added successfully', patient: result.rows[0] });

  } catch (err) {
    console.error(err);
    if (err.code === '23505') {  // unique violation on patient_id
      return res.status(409).json({ message: 'Patient ID already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/patient/:patientId
router.get('/patientdetailed/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;

    if (!patientId) {
      return res.status(400).json({ message: 'Patient ID is required' });
    }

    const query = `
      SELECT *
      FROM patient_detailed_form
      WHERE patient_id = $1
      ORDER BY created_at DESC;
    `;

    const result = await db.query(query, [patientId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No patient found with this ID' });
    }

    res.status(200).json({ patient: result.rows[0], allAppointments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});



// -------------------- READ (GET) --------------------
// Get all appointments
router.get('/all', async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM appointments ORDER BY createdAt DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get appointments by patientId
router.get('/patient/:patientId', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * 
       FROM appointments 
       WHERE patientId = $1 
       ORDER BY createdAt DESC`,
      [req.params.patientId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No appointments found for this patient" });
    }

    // Return all appointment details
    res.json({
      message: "Appointments fetched successfully",
      total: result.rows.length,
      appointments: result.rows
    });
  } catch (err) {
    console.error("Error fetching appointments by patient ID:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ✅ Get appointments by doctorId
router.get('/doctor/:doctorId', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, doctorId, doctorName, yearsOfExperience, department, date, timeSlot, consultantFees, paymentStatus,status, patientId, name, age, gender, bloodGroup, reason ,tokenid
       FROM appointments 
       WHERE doctorId = $1 
       ORDER BY createdAt DESC`,
      [req.params.doctorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No appointments found for this doctor" });
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching doctor appointments:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get appointment by ID
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM appointments WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


// -------------------- UPDATE (PUT) --------------------
router.put('/update/:id', async (req, res) => {
    const {
        doctorId,
        doctorName,
        yearsOfExperience,
        department,
        date,
        timeSlot,
        consultantFees,
        patientId,
        name,
        age,
        gender,
        bloodGroup,
        reason,
        paymentStatus,
        patientPhone
    } = req.body;

    try {
        const updateQuery = `
            UPDATE appointments
            SET doctorId = COALESCE($1, doctorId),
                doctorName = COALESCE($2, doctorName),
                yearsOfExperience = COALESCE($3, yearsOfExperience),
                department = COALESCE($4, department),
                date = COALESCE($5, date),
                timeSlot = COALESCE($6, timeSlot),
                consultantFees = COALESCE($7, consultantFees),
                patientId = COALESCE($8, patientId),
                name = COALESCE($9, name),
                age = COALESCE($10, age),
                gender = COALESCE($11, gender),
                bloodGroup = COALESCE($12, bloodGroup),
                reason = COALESCE($13, reason),
                paymentStatus = COALESCE($14, paymentStatus),
                patientPhone = COALESCE($15, patientPhone)
            WHERE id = $16
            RETURNING *;
        `;

        const values = [
            doctorId,
            doctorName,
            yearsOfExperience,
            department,
            date,
            timeSlot,
            consultantFees,
            patientId,
            name,
            age,
            gender,
            bloodGroup,
            reason,
            paymentStatus || null,
            patientPhone,
            req.params.id
        ];

        const result = await db.query(updateQuery, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        res.json({
            message: "Appointment updated successfully",
            appointment: result.rows[0]
        });
    } catch (err) {
        console.error("Error updating appointment:", err);
        res.status(500).json({ error: "Server error" });
    }
});



router.put("/upcomingvisits/update/:id", async (req, res) => {
  const { id } = req.params;
  const { date } = req.body;

  if (!date) return res.status(400).json({ success: false, message: "Date is required" });

  try {
    const result = await db.query(
      "UPDATE appointments SET date = $1 WHERE id = $2 RETURNING *",
      [date, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------------------- DELETE --------------------
router.delete('/delete/:tokenid', async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM appointments WHERE tokenid = $1 RETURNING *`,
      [req.params.tokenid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    res.json({ message: "Appointment deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- UPDATE STATUS --------------------
router.put("/update-status", async (req, res) => {
  const { tokenid, daily_id, status, date, doctorId } = req.body; // <-- add doctorId
  console.log("🧾 Incoming:", { tokenid, daily_id, status, date, doctorId });

  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  if (!tokenid && !daily_id) {
    return res.status(400).json({ error: "Either tokenid or daily_id is required" });
  }

  if (!date) {
    return res.status(400).json({ error: "Date is required to update status" });
  }

  if (!doctorId) {
    return res.status(400).json({ error: "Doctor ID is required to update status" });
  }

  try {
    let result;

    if (tokenid) {
      // Add doctor_id filter
      result = await db.query(
        `UPDATE appointments 
         SET status = $1 
         WHERE tokenid = $2 AND date::date = $3 AND doctorid = $4
         RETURNING *;`,
        [status, tokenid, date, doctorId]
      );
    } else if (daily_id) {
      result = await db.query(
        `UPDATE doctorbooking 
         SET status = $1 
         WHERE daily_id = $2 AND appointment_date::date = $3 AND doctor_id = $4
         RETURNING *;`,
        [status, daily_id, date, doctorId]
      );
    }

    if (!result || result.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    res.json({
      message: "Appointment status updated successfully",
      appointment: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error updating appointment status:", err);
    res.status(500).json({ error: "Server error" });
  }
});




module.exports = router;
