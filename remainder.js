const cron = require("node-cron");
const db = require("./db");
const SendEmail = require("./utils/SenEmail");
const QRCode = require("qrcode");

function startReminderJob() {
  console.log("🟢 Cron initialized");

  // ✅ Runs every day at 6:00 PM IST
  cron.schedule(
    "0 18 * * *",
    async () => {
      console.log("🔔 Running 1-day-before reminder:", new Date());

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
          if (!appt.patientemail) continue;

          // 🚨 SAFETY CHECK
          if (!appt.qrdata) {
            console.log("❌ Missing QR data for appointment:", appt.id);
            continue;
          }

          // ✅ Generate QR from STORED DATA (IMPORTANT)
          const qrImage = await QRCode.toDataURL(appt.qrdata, {
            width: 300,
            margin: 2,
          });

          await SendEmail({
            to: appt.patientemail,
            subject: `⏰ Reminder: Your Appointment is Tomorrow`,

            // ✅ CID ATTACHMENT (correct for email clients)
            attachments: [
              {
                filename: "qr.png",
                content: Buffer.from(qrImage.split("base64,")[1], "base64"),
                cid: "qrimage",
              },
            ],

            html: `
              <div style="font-family:Arial;text-align:center;padding:15px">

                <h2 style="color:#1E3A8A">⏰ Appointment Reminder</h2>

                <p>Dear <b>${appt.name}</b>,</p>

                <p style="font-size:15px">
                  This is a reminder that your appointment is scheduled for <b>TOMORROW</b>.
                </p>

                <hr/>

                <h3>👨‍⚕️ Doctor Details</h3>
                <p><b>Dr:</b> ${appt.doctorname}</p>
                <p><b>Date:</b> ${appt.date}</p>
                <p><b>Time:</b> ${appt.timeslot}</p>
                <p><b>Token Number:</b> ${appt.tokenid}</p>

                <hr/>

                <h3>📱 Scan QR Code at Hospital</h3>

                <!-- ✅ FIXED QR DISPLAY -->
                <img src="cid:qrimage" style="width:180px;border-radius:10px" />

                <p style="margin-top:15px;color:#444;font-size:14px">
                  ⏳ Please arrive <b>10–15 minutes before your appointment</b>.
                </p>

                <p style="color:#555;font-size:13px;margin-top:10px">
                  🙏 Thank you for choosing our hospital.
                </p>

                <p style="color:red;font-size:12px;margin-top:10px">
                  ⚠️ This is an automated message. Please do not reply.
                </p>

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

        console.log("✅ Reminder job completed");
      } catch (err) {
        console.error("❌ Reminder error:", err.message);
      }
    },
    {
      timezone: "Asia/Kolkata",
    }
  );
}

module.exports = startReminderJob;