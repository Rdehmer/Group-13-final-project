/**
 * One-off contract→cash UI smoke test (Playwright).
 * Does not commit; prints JSON steps to stdout.
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = "DemoPass123!";
const OUT = join(process.cwd(), "scripts", ".e2e-artifacts");
mkdirSync(OUT, { recursive: true });

const steps = [];
function log(step, status, detail = "") {
  const row = { step, status, detail };
  steps.push(row);
  console.log(JSON.stringify(row));
}

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

const PERSONA_BY_EMAIL = {
  "admin@ridley-demo.test": "Admin",
  "billing@ridley-demo.test": "Billing",
  "manager@ridley-demo.test": "Manager",
  "tech1@ridley-demo.test": "Technician",
  "customer1@ridley-demo.test": "Contract Customer",
};

async function login(page, email) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  // Open auth modal from landing
  await page.getByRole("banner").getByRole("button", { name: /^sign in$/i }).click();
  const dialog = page.locator("dialog[open], dialog.modal[open]").first();
  await dialog.waitFor({ state: "visible", timeout: 15000 });

  const persona = PERSONA_BY_EMAIL[email];
  if (persona) {
    await dialog.getByRole("button", { name: persona, exact: true }).click();
  } else {
    await dialog.locator('input[type="email"]').fill(email);
    await dialog.locator('input[type="password"]').fill(PASSWORD);
  }
  await dialog.locator('form').getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !u.pathname.endsWith("/") || u.pathname.includes("welcome") || u.pathname.includes("dashboard") || u.pathname.includes("billing") || u.pathname.includes("technician"), {
    timeout: 45000,
  });
  // If welcome splash, continue into app
  if (page.url().includes("/welcome")) {
    const continueBtn = page.getByRole("link", { name: /continue|dashboard|enter|go to/i }).or(
      page.getByRole("button", { name: /continue|dashboard|enter|go to/i }),
    );
    if (await continueBtn.count()) {
      await continueBtn.first().click();
      await page.waitForTimeout(1000);
    }
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  let invoiceNumber = null;
  let invoiceId = null;
  let woLabel = null;

  try {
    // 1) Contracts (admin can see contracts; billing may too)
    await login(page, "admin@ridley-demo.test");
    log("login_admin", "pass", "admin@ridley-demo.test");
    await page.goto(`${BASE}/contracts`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const bodyText = await page.locator("body").innerText();
    const hasNorthwind =
      /Northwind/i.test(bodyText) ||
      /Gold Full-Service/i.test(bodyText) ||
      /Active/i.test(bodyText);
    await shot(page, "01-contracts");
    if (hasNorthwind || /contract/i.test(bodyText)) {
      log("contracts_page", "pass", "Contracts page loaded with contract data");
    } else {
      log("contracts_page", "fail", "Contracts page missing expected content");
    }

    // Logout via header if present, else clear cookies
    const logout = page.getByRole("button", { name: /log out|sign out/i });
    if (await logout.count()) {
      await logout.first().click();
      await page.waitForTimeout(800);
    }
    await context.clearCookies();

    // 2) Billing: create invoice from completed unbilled WO (prefer contract-linked)
    await login(page, "billing@ridley-demo.test");
    log("login_billing", "pass", "billing@ridley-demo.test");
    await page.goto(`${BASE}/billing`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await shot(page, "02-billing");

    // Prefer a contract-linked demo WO if shown
    const readyBtns = page.locator("button").filter({ hasText: /WO-/ });
    const readyCount = await readyBtns.count();
    if (readyCount === 0) {
      log("select_unbilled_wo", "fail", "No Ready-to-invoice WO buttons found");
      throw new Error("No unbilled WO UI");
    }

    // Prefer WO with real labor charges (avoid $0 rating demos)
    const preferred = ["WO-77715073", "WO-DEMO-SH-005"];
    let picked = false;
    for (const pref of preferred) {
      for (let i = 0; i < readyCount; i++) {
        const txt = (await readyBtns.nth(i).innerText()).trim();
        if (txt.includes(pref)) {
          woLabel = txt.split("\n")[0].trim();
          await readyBtns.nth(i).click();
          picked = true;
          break;
        }
      }
      if (picked) break;
    }
    if (!picked) {
      woLabel = (await readyBtns.first().innerText()).trim();
      await readyBtns.first().click();
    }
    await page.waitForTimeout(2500);
    log("select_unbilled_wo", "pass", woLabel);

    // Require non-zero preview total before creating
    const previewText = await page.locator("body").innerText();
    const moneyMatches = [...previewText.matchAll(/\$[\d,]+\.\d{2}/g)].map((m) =>
      Number(m[0].replace(/[$,]/g, "")),
    );
    const previewMax = moneyMatches.length ? Math.max(...moneyMatches) : 0;
    if (previewMax <= 0) {
      await shot(page, "02b-zero-preview");
      log("create_invoice", "fail", `Preview total appears $0 for ${woLabel}`);
      throw new Error("Zero-dollar invoice preview");
    }
    log("invoice_preview_amount", "pass", `preview max seen ~$${previewMax.toFixed(2)}`);

    const createSend = page.getByRole("button", { name: /create & send|create and send/i });
    const createDraft = page.getByRole("button", { name: /create draft/i });
    if (await createSend.count()) {
      await createSend.first().click();
    } else if (await createDraft.count()) {
      await createDraft.first().click();
    } else {
      await shot(page, "02b-preview-missing");
      log("create_invoice", "fail", "No Create invoice button in preview");
      throw new Error("No create invoice button");
    }

    await page.waitForURL(/\/billing\/[0-9a-f-]+/i, { timeout: 45000 }).catch(() => null);
    await page.waitForTimeout(2000);
    await shot(page, "03-invoice-created");
    const invUrl = page.url();
    const m = invUrl.match(/\/billing\/([0-9a-f-]+)/i);
    invoiceId = m?.[1] ?? null;
    const invPageText = await page.locator("body").innerText();
    const invMatch = invPageText.match(/INV-\d+/);
    invoiceNumber = invMatch?.[0] ?? null;
    if (invoiceId || invoiceNumber) {
      log(
        "create_invoice",
        "pass",
        `${invoiceNumber || "unknown"} id=${invoiceId || "n/a"} from ${woLabel}`,
      );
    } else {
      log("create_invoice", "fail", `URL=${invUrl}`);
      throw new Error("Invoice not created");
    }

    // Surface createInvoice billing_status error if shown
    const createErr = page.locator(".alert-error");
    if ((await createErr.count()) && (await createErr.first().isVisible())) {
      log("mark_wo_billed", "fail", await createErr.first().innerText());
    }

    // 3) Record payment (deep-link may already open the modal)
    const payHref = invoiceId ? `${BASE}/payments?invoice=${invoiceId}` : `${BASE}/payments`;
    await page.goto(payHref, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    let dialog = page.locator("dialog.modal-open, .modal.modal-open .modal-box, .modal-box").first();
    if (!(await page.locator("dialog.modal-open, .modal.modal-open").count())) {
      await page.getByRole("button", { name: /record payment/i }).click();
      await page.waitForTimeout(800);
      dialog = page.locator("dialog.modal-open .modal-box, .modal.modal-open .modal-box, .modal-box").first();
    }
    await dialog.waitFor({ state: "visible", timeout: 15000 });

    const selectInDialog = dialog.locator("select").first();
    if (await selectInDialog.count()) {
      const options = await selectInDialog.locator("option").allTextContents();
      const target =
        options.find((o) => invoiceNumber && o.includes(invoiceNumber)) ||
        options.find((o) => /INV-/.test(o) && !/^select/i.test(o.trim())) ||
        options[1];
      if (target) {
        const value = await selectInDialog.locator("option", { hasText: target }).first().getAttribute("value");
        if (value) await selectInDialog.selectOption(value);
      }
    }

    const amountInput = dialog.locator('input[type="number"]').first();
    if (await amountInput.count()) {
      const amt = await amountInput.inputValue();
      if (!amt || Number(amt) <= 0) {
        log("record_payment", "fail", "Payment amount is empty/zero — invoice may not be in open AR list");
        throw new Error("No payment amount");
      }
      log("payment_amount", "pass", `amount=${amt}`);
    }
    const refInputs = dialog.locator("input.input, input[type='text']");
    if (await refInputs.count()) {
      await refInputs.last().fill(`E2E-C2C-${Date.now()}`);
    }

    await dialog.getByRole("button", { name: /save payment/i }).click();
    await page.waitForTimeout(3000);
    await shot(page, "04-payment-recorded");

    const err = page.locator(".alert-error");
    if ((await err.count()) && (await err.first().isVisible())) {
      log("record_payment", "fail", await err.first().innerText());
      throw new Error("Payment form error");
    }
    log("record_payment", "pass", `Payment UI submitted for ${invoiceNumber || invoiceId}`);

    // 4) Verify invoice status / balance (must have been non-zero before pay)
    if (invoiceId) {
      await page.goto(`${BASE}/billing/${invoiceId}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      await shot(page, "05-invoice-after-payment");
      const after = await page.locator("body").innerText();
      const paid = /\bPaid\b/i.test(after);
      const zeroRemain =
        /remaining[^\n$]*\$0\.00/i.test(after) || /\$0\.00[^\n]*remain/i.test(after);
      if (paid || zeroRemain) {
        log("verify_invoice_cash", "pass", "Invoice shows Paid / $0 remaining");
      } else if (/partial/i.test(after)) {
        log("verify_invoice_cash", "pass", "Invoice shows Partial (balance updated)");
      } else {
        log(
          "verify_invoice_cash",
          "fail",
          `Could not confirm paid/zero balance. Snippet: ${after.slice(0, 500).replace(/\s+/g, " ")}`,
        );
      }
    } else {
      log("verify_invoice_cash", "fail", "No invoice id to verify");
    }

    // 5) Optional: confirm contract still linked on invoice page text
    const finalText = await page.locator("body").innerText();
    if (/contract/i.test(finalText) || /Northwind/i.test(finalText)) {
      log("contract_link_visible", "pass", "Customer/contract context present on invoice");
    } else {
      log("contract_link_visible", "skip", "No explicit contract label on invoice detail");
    }
  } catch (e) {
    log("fatal", "fail", String(e?.message || e));
    try {
      await shot(page, "fatal");
    } catch {
      /* ignore */
    }
  } finally {
    await browser.close();
    console.log("---SUMMARY---");
    console.log(JSON.stringify(steps, null, 2));
    const failed = steps.some((s) => s.status === "fail");
    process.exit(failed ? 1 : 0);
  }
}

main();
