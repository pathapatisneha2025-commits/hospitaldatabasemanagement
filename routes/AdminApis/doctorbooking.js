const express = require("express");
const pool = require("../../db");
const router = express.Router();
const QRCode = require("qrcode"); // ✅ MUST IMPORT
const cron = require("node-cron");
const transporter = require("../../utils/transpotar");
const twilio = require("twilio");
const client = twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_AUTH_TOKEN
);


const sendSMS = async (phone, message) => {
  try {
    const res = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE,
      to: phone,
    });

    console.log("📩 SMS Sent:", res.sid);
    return true;
  } catch (err) {
    console.log("❌ SMS Error:", err.message);
    return false;
  }
};


const makeVoiceCall = async (phone, doctorName, date, timeSlot, token) => {
  try {
    await client.calls.create({
      to: phone,
      from: process.env.TWILIO_PHONE,
  twiml: `
<Response>

  <Say voice="alice">
    Hello. Your appointment is confirmed.
    Doctor ${doctorName}.
    Date ${date}.
    Time ${timeSlot}.
    Token number ${token}.
  </Say>

  <Pause length="1"/>

  <Say voice="alice">
    नमस्ते। आपका अपॉइंटमेंट कन्फर्म हो गया है।
    डॉक्टर ${doctorName}.
    दिनांक ${date}.
    समय ${timeSlot}.
    टोकन नंबर ${token} है।
  </Say>

  <Pause length="1"/>

  <Say voice="alice">
    Please arrive 10 to 15 minutes early. Thank you.
  </Say>

</Response>
`,
    });

    console.log("📞 Voice call sent successfully");
  } catch (err) {
    console.log("❌ Call error:", err.message);
  }
};

const makeRescheduleCall = async (phone, name, doctorId, newDate, newTime, token) => {
  try {
    const twiml = `
<Response>

  <Say voice="alice" language="en-IN">
    Hello ${name}. Your appointment has been rescheduled.
  </Say>

  <Pause length="1"/>

  <Say voice="alice" language="en-IN">
    Doctor ID ${doctorId}.
    New date ${newDate}.
    New time ${newTime}.
    Token number ${token}.
  </Say>

  <Pause length="1"/>

  <Say voice="alice" language="hi-IN">
    नमस्ते ${name}.
    आपकी अपॉइंटमेंट बदल दी गई है।
    कृपया समय पर अस्पताल पहुंचे।
    धन्यवाद।
  </Say>

</Response>`;

    await client.calls.create({
      to: phone,
      from: process.env.TWILIO_PHONE,
      twiml,
    });

    console.log("📞 Reschedule call sent");
  } catch (err) {
    console.log("❌ Call error:", err.message);
  }
};
const formatPhone = (num) => {
  if (!num) return null;

  let cleaned = num.toString().replace(/\D/g, "");

  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }

  if (cleaned.startsWith("91") && cleaned.length === 12) {
    return `+${cleaned}`;
  }

  return `+${cleaned}`;
};
router.post("/add", async (req, res) => {
  try {
    const {
      employeeId,
      doctorId,
      patientId,
      patientName,
      patientAge,
      patientGender,
      patientBloodGroup,
      patientPhone,
      patientAddress,

      doctorName,
      specialization,
      experience,
      rating,
      availableDays,
      availableTime,
      appointmentDate,
      appointmentTime,
      doctorDescription,
      paymentType,
      doctorConsultantFee,
      doctorEmail,
        tokenId,

    } = req.body;

    // ================= DUPLICATE CHECK =================
    // const existingAppointment = await pool.query(
    //   `SELECT * FROM doctorbooking 
    //    WHERE doctor_id = $1 
    //    AND appointment_date = $2, 
    //    AND appointment_time = $3`,
    //   [doctorId, appointmentDate, appointmentTime]
    // );

    // if (existingAppointment.rows.length > 0) {
    //   return res.status(400).json({
    //     error: "Doctor is already booked for this time slot",
    //   });
    // }

    // ================= VISIT LIMIT =================
//     const visitData = await pool.query(
//   `SELECT number_of_visits_per_day 
//    FROM doctor_visits
//    WHERE doctor_email = $1
//    LIMIT 1`,
//   [doctorEmail]
// );

//     if (visitData.rows.length === 0) {
//       return res.status(400).json({
//         error: `No visit limit set for Dr. ${doctorName}`,
//       });
//     }

//     const MAX_APPOINTMENTS_PER_DOCTOR_PER_DAY = parseInt(
//       visitData.rows[0].number_of_visits_per_day,
//       10
//     );

    // ================= TOKEN LOGIC =================
    const lastToken = await pool.query(
      `
      SELECT MAX(tokenid) AS last_token
      FROM (
        SELECT tokenid 
        FROM appointments 
        WHERE doctorid = $1 
        AND date::date = TO_DATE($2, 'YYYY-MM-DD')

        UNION ALL

        SELECT daily_id AS tokenid 
        FROM doctorbooking 
        WHERE doctor_id::integer = $1 
        AND appointment_date::date = TO_DATE($2, 'YYYY-MM-DD')
      ) AS combined;
      `,
      [doctorId, appointmentDate]
    );

    const reserveData = await pool.query(
      `SELECT reserved_count 
       FROM reserve_rules
       WHERE doctor_id = $1 
       AND date::date = TO_DATE($2, 'YYYY-MM-DD')
       LIMIT 1`,
      [doctorId, appointmentDate]
    );

    const reservedCount =
      reserveData.rows.length > 0
        ? parseInt(reserveData.rows[0].reserved_count, 10)
        : 0;

const nextDailyId = Number(tokenId);

if (!nextDailyId || isNaN(nextDailyId)) {
  return res.status(400).json({
    error: "Invalid token ID",
  });
}
    // if (!lastToken.rows[0].last_token) {
    //   nextDailyId = reservedCount + 1;
    // } else {
    //   nextDailyId = parseInt(lastToken.rows[0].last_token, 10) + 1;
    // }

    // if (nextDailyId > MAX_APPOINTMENTS_PER_DOCTOR_PER_DAY) {
    //   return res.status(200).json({
    //     alert: true,
    //     message: `No bookings available for Dr. ${doctorName} today.`,
    //   });
    // }

    // ================= 🔥 GENERATE 4-DIGIT UNIQUE PATIENT ID =================
    let patientUniqueId;
    let isUnique = false;

    while (!isUnique) {
      patientUniqueId = Math.floor(1000 + Math.random() * 9000);

      const check = await pool.query(
        `SELECT patient_unique_id FROM doctorbooking WHERE patient_unique_id = $1`,
        [patientUniqueId]
      );

      if (check.rows.length === 0) {
        isUnique = true;
      }
    }
    // ================= INSERT BOOKING =================
    const result = await pool.query(
      `INSERT INTO doctorbooking (
        daily_id, employee_id, doctor_id, patient_id,
        patient_unique_id,
        patient_name, patient_age, patient_gender, patient_blood_group,
        patient_phone, patient_address,

        doctor_name, specialization, experience, rating,
        available_days, available_time, doctor_description,
        appointment_date, appointment_time,
        payment_type, doctor_consultant_fee,
        status
      )
      VALUES (
        $1,$2,$3,$4,
        $5,
        $6,$7,$8,$9,
        $10,$11,

        $12,$13,$14,$15,
        $16,$17,$18,
        $19,$20,
        $21,$22,
        'pending'
      )
      RETURNING *`,
      [
        nextDailyId,
        employeeId,
        doctorId,
        patientId,

        patientUniqueId, // ✅ 4-digit unique ID

        patientName,
        patientAge,
        patientGender,
        patientBloodGroup,
        patientPhone,
        patientAddress,

        doctorName,
        specialization,
        experience,
        rating,
        availableDays,
        availableTime,
        doctorDescription,
        appointmentDate,
        appointmentTime,
        paymentType,
        doctorConsultantFee,
      ]
    );

    const appointment = result.rows[0];

    // ================= RESPONSE =================
    res.json({
      message: `Appointment created successfully for Dr. ${doctorName}`,
      appointment,
    });

  } catch (err) {
    console.error("❌ Error booking appointment:", err);
    res.status(500).json({ error: "Server error" });
  }
});


/* =========================================================
    2️⃣ GET ALL APPOINTMENTS
========================================================= */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM doctorbooking ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching appointments:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
    3️⃣ GET APPOINTMENTS BY EMPLOYEE ID
========================================================= */
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const result = await pool.query(
      "SELECT * FROM doctorbooking WHERE employee_id = $1 ORDER BY created_at DESC",
      [employeeId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching employee appointments:", err);
    res.status(500).json({ error: "Server error" });
  }
});
router.get("/patient/:patientId", async (req, res) => {
  try {
    const { patientId } = req.params;
    const result = await pool.query(
      "SELECT * FROM doctorbooking WHERE patient_id = $1 ORDER BY created_at DESC",
      [patientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching patient appointments:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/doctor/:doctorId", async (req, res) => {
  try {
    const { doctorId } = req.params;
    const result = await pool.query(
      "SELECT * FROM doctorbooking WHERE doctor_id = $1 ORDER BY created_at DESC",
      [doctorId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching doctor appointments:", err);
    res.status(500).json({ error: "Server error" });
  }
});
router.get("/doctorwise", async (req, res) => {
  try {
    const { employee_id, doctor_id, date } = req.query;

    let query = `
      SELECT *
      FROM doctorbooking
      WHERE 1=1
    `;

    const values = [];
    let i = 1;

    if (employee_id) {
      query += ` AND employee_id = $${i}`;
      values.push(employee_id);
      i++;
    }

    if (doctor_id) {
      query += ` AND doctor_id = $${i}`;
      values.push(doctor_id);
      i++;
    }

    if (date) {
      query += ` AND DATE(appointment_date) = $${i}`;
      values.push(date);
      i++;
    }

    query += ` ORDER BY appointment_time ASC`;

    const result = await pool.query(query, values);

    const data = result.rows;

    // 🔥 GROUPING + REVENUE CALCULATION
    const grouped = {};

    data.forEach((item) => {
      const key = `${item.employee_id}_${item.doctor_id}_${item.appointment_date?.toString().split("T")[0]}`;

      if (!grouped[key]) {
        grouped[key] = {
          employee_id: item.employee_id,
          doctor_id: item.doctor_id,
          doctor_name: item.doctor_name,
          specialization: item.specialization,
          date: item.appointment_date?.toString().split("T")[0],
          total_patients: 0,
          total_revenue: 0,
          patients: [],
        };
      }

      grouped[key].total_patients += 1;
      grouped[key].total_revenue += Number(item.doctor_consultant_fee || 0);

      grouped[key].patients.push({
        patient_id: item.patient_id,
        patient_name: item.patient_name,
        age: item.patient_age,
        gender: item.patient_gender,
        phone: item.patient_phone,
        token_time: item.appointment_time,
        payment_type: item.payment_type,
        fee: Number(item.doctor_consultant_fee || 0),
        status: item.status,
      });
    });

    res.json({
      success: true,
      count: data.length,
      result: Object.values(grouped),
    });

  } catch (err) {
    console.error("Doctor booking fetch error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});
/* =========================================================
    4️⃣ GET SINGLE APPOINTMENT BY DATABASE ID
========================================================= */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM doctorbooking WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Appointment not found" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching appointment:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
    5️⃣ UPDATE APPOINTMENT DETAILS
========================================================= */
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      patientName,
      patientAge,
      patientPhone,
      doctorName,
      specialization,
      experience,
      rating,
      availableDays,
      availableTime,
      appointmentDate,
      appointmentTime,
      doctorDescription,
      paymentType,
      doctorConsultantFee
    } = req.body;

    const result = await pool.query(
      `UPDATE doctorbooking
       SET patient_name = $1, patient_age = $2, patient_phone = $3,
           doctor_name = $4, specialization = $5, experience = $6,
           rating = $7, available_days = $8, available_time = $9,
           doctor_description = $10,
           appointment_date = $11, appointment_time = $12,
           payment_type = $13, doctor_consultant_fee = $14
       WHERE id = $15
       RETURNING *`,
      [
        patientName,
        patientAge,
        patientPhone,
        doctorName,
        specialization,
        experience,
        rating,
        availableDays,
        availableTime,
        doctorDescription,
        appointmentDate,
        appointmentTime,
        paymentType,
        doctorConsultantFee,
        id
      ]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Appointment not found" });

    res.json({
      message: "Appointment updated successfully",
      appointment: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating appointment:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// Update appointment_date for doctorbooking
router.put("/upcomingvisits/update/:id", async (req, res) => {
  const { id } = req.params;
  const { appointment_date } = req.body;

  if (!appointment_date) return res.status(400).json({ success: false, message: "Date is required" });

  try {
    const result = await pool.query(
      "UPDATE doctorbooking SET appointment_date = $1 WHERE id = $2 RETURNING *",
      [appointment_date, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
/* =========================================================
    6️⃣ DELETE APPOINTMENT
========================================================= */
router.delete("/delete/:daily_id", async (req, res) => {
  try {
    const { daily_id } = req.params;
    const result = await pool.query(
      "DELETE FROM doctorbooking WHERE daily_id = $1 RETURNING *",
      [daily_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    res.json({ message: "Appointment deleted successfully" });
  } catch (err) {
    console.error("Error deleting appointment:", err);
    res.status(500).json({ error: "Server error" });
  }
});


/* =========================================================
    7️⃣ UPDATE STATUS
========================================================= */
router.put("/update-status", async (req, res) => {
  try {
    const { id, status } = req.body;

    // ✅ Validate both fields
    if (!id) return res.status(400).json({ error: "ID is required" });
    if (!status) return res.status(400).json({ error: "Status is required" });

    const result = await pool.query(
      "UPDATE doctorbooking SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Appointment not found" });

    res.json({
      message: "Status updated successfully",
      appointment: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating status:", err);
    res.status(500).json({ error: "Server error" });
  }
});


module.exports = router;
