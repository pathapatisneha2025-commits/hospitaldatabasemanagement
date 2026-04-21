const cron = require("node-cron");
const db = require("./db");
const SendEmail = require("./utils/SenEmail");
const QRCode = require("qrcode");

function startReminderJob() {
  console.log("🟢 Cron initialized");

  cron.schedule(
    "* * * * *", // 1-minute test
    async () => {
      console.log("🔔 Running reminder job:", new Date());

      try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const date = tomorrow.toISOString().split("T")[0];

        const result = await db.query(
          `SELECT * FROM appointments 
           WHERE DATE(date) = $1 
           AND (reminder_sent IS NULL OR reminder_sent = false)`,
          [date]
        );

        console.log("📊 Found:", result.rows.length);

        for (let appt of result.rows) {
          if (!appt.patientemail || !appt.qrdata) continue;

          // ✅ QR GENERATION
          const qrImage = await QRCode.toDataURL(appt.qrdata);

          // ✅ IMPORTANT FIX: convert base64 → buffer for email attachment
          const qrBuffer = Buffer.from(qrImage.split(",")[1], "base64");

          await SendEmail({
            to: appt.patientemail,
            subject: "⏰ Reminder: Your Appointment is Tomorrow",

            attachments: [
              {
                filename: "qr.png",
                content: qrBuffer,
                cid: "qrimage",
                contentType: "image/png",
              },
            ],

            html: `
              <div style="font-family:Arial;text-align:center;padding:15px">

                <h2>⏰ Appointment Reminder</h2>

                <p>Dear <b>${appt.name}</b>,</p>

                <p>Your appointment is tomorrow.</p>

                <hr/>

                <p><b>Doctor:</b> ${appt.doctorname}</p>
                <p><b>Date:</b> ${appt.date}</p>
                <p><b>Time:</b> ${appt.timeslot}</p>
                <p><b>Token:</b> ${appt.tokenid}</p>

                <hr/>

                <h3>📱 Scan QR Code</h3>

                <!-- ✅ THIS WILL WORK 100% -->
                <img src="cid:qrimage" width="180" />

              </div>
            `,
          });

          await db.query(
            `UPDATE appointments 
             SET reminder_sent = true 
             WHERE id = $1`,
            [appt.id]
          );

          console.log("✅ Sent:", appt.patientemail);
        }
      } catch (err) {
        console.error("❌ Error:", err.message);
      }
    }
  );
}

module.exports = startReminderJob;