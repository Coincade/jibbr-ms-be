/**
 * Send a dummy test email to verify templates and SMTP config.
 * Usage: npx tsx src/scripts/send-test-email.ts your@email.com
 * Or:   TEST_EMAIL=your@email.com npx tsx src/scripts/send-test-email.ts
 */
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import ejs from "ejs";
import { mailHelper } from "../config/mail.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const to = process.argv[2] || process.env.TEST_EMAIL;
  if (!to) {
    console.error("Usage: npx tsx src/scripts/send-test-email.ts your@email.com");
    console.error("   Or: TEST_EMAIL=your@email.com npx tsx src/scripts/send-test-email.ts");
    process.exit(1);
  }

  const templatesDir = path.join(__dirname, "..", "views", "emails");

  // Render verification email template
  const html = await ejs.renderFile(path.join(templatesDir, "email-verify.ejs"), {
    name: "Test User",
    url: "https://example.com/verify-email?token=test",
  });

  await mailHelper(to, "Jibbr | Test Email (Verification Template)", html);
  console.log("✅ Test email sent to", to);
}

main().catch((err) => {
  console.error("❌ Failed to send email:", err.message);
  process.exit(1);
});
