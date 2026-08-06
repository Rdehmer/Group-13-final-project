/**
 * Full multi-role contract→cash E2E (Playwright).
 * Path: Customer request → Manager assign → Tech complete → Billing invoice/pay.
 * Does not commit; prints JSON steps + summary to stdout.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = "DemoPass123!";
const OUT = join(process.cwd(), "scripts", ".e2e-artifacts-full-c2c");
mkdirSync(OUT, { recursive: true });

const steps = [];
const ids = {
  branch: "Billing-John",
  requestId: null,
  woNumber: null,
  woId: null,
  invoiceNumber: null,
  invoiceId: null,
  paymentAmount: null,
  invoiceTotal: null,
};

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

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PERSONA_BY_EMAIL = {
  "admin@equipmentiq-demo.test": "Admin",
  "billing@equipmentiq-demo.test": "Billing",
  "manager@equipmentiq-demo.test": "Manager",
  "tech1@equipmentiq-demo.test": "Technician",
  "customer1@equipmentiq-demo.test": "Contract Customer",
};

async function login(page, email) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
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
  await dialog.locator("form").getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(
    (u) =>
      !u.pathname.endsWith("/") ||
      u.pathname.includes("welcome") ||
      u.pathname.includes("dashboard") ||
      u.pathname.includes("billing") ||
      u.pathname.includes("technician") ||
      u.pathname.includes("customer"),
    { timeout: 45000 },
  );
  if (page.url().includes("/welcome")) {
    await page.waitForURL((u) => !u.pathname.includes("welcome"), { timeout: 15000 }).catch(() => null);
    if (page.url().includes("/welcome")) {
      const continueBtn = page
        .getByRole("link", { name: /continue|dashboard|enter|go to/i })
        .or(page.getByRole("button", { name: /continue|dashboard|enter|go to/i }));
      if (await continueBtn.count()) {
        await continueBtn.first().click();
        await page.waitForTimeout(1000);
      }
    }
  }
}

async function logout(page, context) {
  const logoutBtn = page.locator("button.eq-signout, button[title='Sign out']").or(
    page.getByRole("button", { name: /sign out|log out/i }),
  );
  if (await logoutBtn.count()) {
    await logoutBtn.first().click();
    await page.waitForTimeout(1000);
  }
  await context.clearCookies();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  const marker = `E2E full C2C ${Date.now()}`;

  try {
    // ── 1) Customer: create service request ──────────────────────────────
    await login(page, "customer1@equipmentiq-demo.test");
    log("login_customer", "pass", "customer1@equipmentiq-demo.test (Contract Customer / Northwind)");

    // Clear mandatory service-rating gate from prior completed jobs
    async function clearRatingGates() {
      for (let i = 0; i < 5; i++) {
        const heading = page.getByRole("heading", { name: /Rate Your Service/i });
        if (!(await heading.count())) break;
        const overallGroup = page.getByRole("radiogroup", { name: /Overall Experience/i });
        if (await overallGroup.count()) {
          await overallGroup.getByRole("radio").nth(4).click(); // 5 stars
        } else {
          await page.getByTitle("5 stars").first().click();
        }
        const submitRating = page.getByRole("button", { name: /Submit Rating/i });
        if (!(await submitRating.count())) break;
        await submitRating.click();
        await page.waitForTimeout(2000);
        log("customer_rating_gate", "pass", `Cleared rating gate attempt ${i + 1}`);
      }
    }

    await page.goto(`${BASE}/customer`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await clearRatingGates();

    await page.goto(`${BASE}/customer/request-service`, { waitUntil: "domcontentloaded" });
    // Wait for wizard Type step (avoid matching sidebar "Request service")
    try {
      await page.locator("label").filter({ hasText: /One-off repair/i }).first().waitFor({
        state: "visible",
        timeout: 30000,
      });
    } catch {
      await clearRatingGates();
      await page.goto(`${BASE}/customer/request-service`, { waitUntil: "domcontentloaded" });
      await page.locator("label").filter({ hasText: /One-off repair/i }).first().waitFor({
        state: "visible",
        timeout: 60000,
      });
    }

    // Type: One-off repair
    await page.locator("label").filter({ hasText: /One-off repair/i }).first().click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForTimeout(500);

    // Equipment: prefer Blast Freezer A (Northwind seed unit)
    const blastRadio = page.locator("label").filter({ hasText: /Blast Freezer A/i }).locator('input[type="radio"]');
    if (await blastRadio.count()) {
      await blastRadio.check();
    } else {
      const firstEq = page.locator('input[type="radio"][name="equipment_id"]').first();
      if (await firstEq.count()) await firstEq.check();
    }
    // Still running?
    const yesRunning = page.locator("label").filter({ hasText: /Yes — still operating/i }).locator('input[type="radio"]');
    if (await yesRunning.count()) await yesRunning.check();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForTimeout(500);

    // Details
    const asap = page.locator("label").filter({ hasText: /As soon as possible/i }).locator('input[type="radio"]');
    if (await asap.count()) await asap.check();
    // Required details textarea — match by placeholder from repair option
    const detailsBox = page.locator(
      'textarea[placeholder*="Describe the issue"], textarea[placeholder*="What should we"], textarea[placeholder*="symptoms"]',
    );
    if (await detailsBox.count()) {
      await detailsBox.first().fill(
        `${marker}: compressor noise / intermittent trip on Blast Freezer A. Created by full multi-role E2E.`,
      );
    } else {
      // FormRow order: access notes then details — fill the larger/last required one
      const areas = page.locator("textarea");
      const n = await areas.count();
      await areas.nth(Math.max(0, n - 1)).fill(
        `${marker}: compressor noise / intermittent trip on Blast Freezer A. Created by full multi-role E2E.`,
      );
    }
    // Verify filled
    const filled = await page.locator("textarea").evaluateAll((nodes) =>
      nodes.map((n) => (n).value || ""),
    );
    if (!filled.some((v) => v.includes("E2E full C2C"))) {
      // Force-fill all empty textareas that look like details
      for (let i = 0; i < (await page.locator("textarea").count()); i++) {
        const ta = page.locator("textarea").nth(i);
        const ph = (await ta.getAttribute("placeholder")) || "";
        if (/Describe|focus|re-check|emergency/i.test(ph) || i === (await page.locator("textarea").count()) - 1) {
          await ta.fill(
            `${marker}: compressor noise / intermittent trip on Blast Freezer A. Created by full multi-role E2E.`,
          );
          break;
        }
      }
    }
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForTimeout(800);
    await shot(page, "01a-customer-confirm");

    // Confirm / submit (may hit 45-day one-off path)
    let submitted = false;
    for (let attempt = 0; attempt < 4 && !submitted; attempt++) {
      const oneOffBtn = page.getByRole("button", { name: /Request One-Off Call/i });
      if ((await oneOffBtn.count()) && (await oneOffBtn.first().isVisible())) {
        await oneOffBtn.first().click();
        log("customer_one_off_path", "pass", "Used One-Off Call due to 45-day contract wait");
      } else {
        const submit = page.getByRole("button", {
          name: /Submit service request|Submit One-Off Call/i,
        });
        if (!(await submit.count())) {
          // Still on details — try Continue again
          const cont = page.getByRole("button", { name: /^continue$/i });
          if (await cont.count()) await cont.first().click();
          await page.waitForTimeout(800);
          continue;
        }
        await submit.first().click();
      }
      try {
        await page.waitForURL(/\/customer\/open-request/, { timeout: 25000 });
        submitted = true;
      } catch {
        await page.waitForTimeout(1500);
        await shot(page, `01b-submit-attempt-${attempt}`);
      }
    }
    await shot(page, "01-customer-request");

    if (!submitted && !page.url().includes("open-request")) {
      const err = page.locator(".alert-error, [role='alert']").first();
      const errText = (await err.count()) ? await err.innerText() : "unknown";
      log("customer_create_request", "fail", `No redirect to open-request. Alert: ${errText.slice(0, 300)}`);
      throw new Error("Customer request failed");
    }

    // Wait for Active Service content (avoid capturing mid-load)
    await page.waitForTimeout(2500);
    const highlight = new URL(page.url()).searchParams.get("highlight");
    ids.requestId = highlight;
    ids.woId = highlight;

    let body = await page.locator("body").innerText();
    let woMatch = body.match(/WO-\d+/);
    if (!woMatch) {
      await page.waitForTimeout(3000);
      body = await page.locator("body").innerText();
      woMatch = body.match(/WO-\d+/);
    }
    ids.woNumber = woMatch?.[0] ?? null;
    await shot(page, "01c-customer-active");

    if (ids.woNumber || ids.requestId) {
      log(
        "customer_create_request",
        "pass",
        `${ids.woNumber || "WO?"} id=${ids.requestId || "n/a"}`,
      );
    } else {
      log("customer_create_request", "fail", "Submitted but no WO number / highlight id");
      throw new Error("Missing WO identity after customer submit");
    }

    await logout(page, context);

    // ── 2) Manager: assign + schedule ────────────────────────────────────
    await login(page, "manager@equipmentiq-demo.test");
    log("login_manager", "pass", "manager@equipmentiq-demo.test");

    if (ids.woId) {
      await page.goto(`${BASE}/work-orders/${ids.woId}`, { waitUntil: "domcontentloaded" });
    } else {
      await page.goto(`${BASE}/work-orders?status=Requested`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      await page.getByText(ids.woNumber, { exact: false }).first().click();
    }
    await page.waitForTimeout(2000);
    await shot(page, "02-manager-wo-before-assign");

    // Capture WO number from detail if customer page was still loading
    if (!ids.woNumber) {
      const mgrBody = await page.locator("body").innerText();
      ids.woNumber = mgrBody.match(/WO-\d+/)?.[0] ?? null;
    }

    // Assign via Dispatch card (Save assignment reads that card's local state — not Job Details)
    const dispatchCard = page.locator(".card").filter({ hasText: /^Dispatch|Technician/ }).filter({
      has: page.getByRole("button", { name: /Save assignment/i }),
    });
    const dispatchRoot = (await dispatchCard.count())
      ? dispatchCard.first()
      : page.locator("body");

    const techSelect = dispatchRoot.locator("select").first();
    await techSelect.waitFor({ state: "visible", timeout: 15000 });
    const techOpts = techSelect.locator("option");
    let techValue = null;
    for (let i = 0; i < (await techOpts.count()); i++) {
      const label = (await techOpts.nth(i).innerText()).trim();
      if (/Taylor Tech/i.test(label)) {
        techValue = await techOpts.nth(i).getAttribute("value");
        break;
      }
    }
    if (!techValue) {
      log("manager_assign_schedule", "fail", "Taylor Tech option not found in Dispatch select");
      throw new Error("No Taylor Tech in Dispatch");
    }
    await techSelect.selectOption(techValue);

    const dateInput = dispatchRoot.locator('input[type="date"]').first();
    await dateInput.fill(todayYmd());

    await dispatchRoot.getByRole("button", { name: /Save assignment/i }).click();
    await page.waitForTimeout(3000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await shot(page, "03-manager-assigned");

    const afterAssign = await page.locator("body").innerText();
    const assignedOk =
      (/Scheduled|Assigned/i.test(afterAssign) && /Taylor Tech/i.test(afterAssign)) ||
      /Taylor Tech/i.test(afterAssign);
    if (assignedOk) {
      log("manager_assign_schedule", "pass", `${ids.woNumber} → Taylor Tech on ${todayYmd()}`);
    } else {
      await shot(page, "03b-assign-failed");
      log(
        "manager_assign_schedule",
        "fail",
        `Assignment not confirmed. Snippet: ${afterAssign.slice(0, 400).replace(/\s+/g, " ")}`,
      );
      throw new Error("Manager assignment failed");
    }

    await logout(page, context);

    // ── 3) Technician: Arrived → Working → Complete + sign-off ───────────
    await login(page, "tech1@equipmentiq-demo.test");
    log("login_tech", "pass", "tech1@equipmentiq-demo.test");

    await page.goto(`${BASE}/technician`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await shot(page, "04-tech-my-day");

    // Prefer deep-link by id; fall back to WO number text
    let jobOpened = false;
    await page.goto(`${BASE}/technician?job=${ids.woId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    if (
      (await page.getByRole("button", { name: /Mark Arrived|Start Working|Complete/i }).count()) > 0 ||
      (await page.getByText(/Customer sign-off|Job checklist|Blast Freezer|E2E full C2C/i).count()) > 0
    ) {
      jobOpened = true;
    } else if (ids.woNumber) {
      await page.goto(`${BASE}/technician`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const woOnDay = page.getByText(ids.woNumber, { exact: false });
      if (await woOnDay.count()) {
        await woOnDay.first().click();
        await page.waitForTimeout(1500);
        jobOpened = true;
      }
    }

    if (!jobOpened) {
      // Last resort: open WO detail as tech and use Ready for Review path
      await page.goto(`${BASE}/work-orders/${ids.woId}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const arrival = page.getByRole("button", { name: /Record arrival/i });
      const start = page.getByRole("button", { name: /Start work/i });
      const ready = page.getByRole("button", { name: /Ready for review/i });
      if (await arrival.count()) {
        await arrival.click();
        await page.waitForTimeout(1500);
      }
      if (await start.count()) {
        await start.click();
        await page.waitForTimeout(1500);
      }
      if (await ready.count()) {
        await ready.click();
        await page.waitForTimeout(2000);
        log("tech_ready_for_review", "pass", "Used WO detail Ready for review path");
        await shot(page, "05-tech-ready-for-review");
        await logout(page, context);

        // Manager approve
        await login(page, "manager@equipmentiq-demo.test");
        await page.goto(`${BASE}/work-orders/${ids.woId}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2000);
        const approve = page.getByRole("button", { name: /Approve & complete/i });
        if (!(await approve.count())) {
          log("manager_approve", "fail", "Approve & complete not available");
          throw new Error("Manager approve missing");
        }
        await approve.click();
        await page.waitForTimeout(2500);
        await shot(page, "06-manager-approved");
        log("manager_approve", "pass", `${ids.woNumber} Approved & completed`);
        await logout(page, context);
      } else {
        log("tech_complete", "fail", "Job not on My Day and no field actions on WO detail");
        throw new Error("Tech could not open/complete job");
      }
    } else {
      await page.waitForTimeout(1500);
      await shot(page, "05-tech-jobsheet");

      // Mark Arrived
      const arrived = page.getByRole("button", { name: /^Mark Arrived$/i });
      if (await arrived.count()) {
        await arrived.first().click();
        await page.waitForTimeout(2500);
        log("tech_arrived", "pass", "Mark Arrived");
      } else {
        log("tech_arrived", "skip", "Already past Arrived");
      }

      // Start Working — may show out-of-scope labor warning first
      async function ackScopeIfNeeded() {
        const scopeWarn = page.getByText(/exceeds contract scope/i);
        if (!(await scopeWarn.count())) return false;
        const ack = page.locator('input[type="checkbox"]').filter({ has: page.locator("xpath=..") });
        // Prefer labeled checkbox
        const labeled = page.getByText(/I confirmed with the customer/i);
        if (await labeled.count()) {
          await page.locator("label").filter({ hasText: /I confirmed with the customer/i }).locator('input[type="checkbox"]').check();
        } else if (await page.locator('input.checkbox, input[type="checkbox"]').count()) {
          await page.locator('input.checkbox, input[type="checkbox"]').first().check();
        }
        const cont = page.getByRole("button", { name: /Continue anyway/i });
        if (await cont.count()) {
          await cont.click();
          await page.waitForTimeout(3000);
        }
        log("tech_scope_ack", "pass", "Acknowledged out-of-scope labor");
        return true;
      }

      async function dismissBlockingAlerts() {
        // Clock-in conflict banner
        const dismiss = page.getByRole("button", { name: /^Dismiss$/i });
        if (await dismiss.count()) {
          await dismiss.first().click();
          await page.waitForTimeout(500);
        }
        // Scope panel may linger after WO already started — Cancel clears it so sticky CTA returns
        const bodyTxt = await page.locator("body").innerText();
        if (/exceeds contract scope/i.test(bodyTxt) && /Working|In Progress/i.test(bodyTxt)) {
          const cancel = page.getByRole("button", { name: /^Cancel$/i });
          if (await cancel.count()) {
            await cancel.first().click();
            await page.waitForTimeout(800);
          }
        }
      }

      const working = page.getByRole("button", { name: /^Start Working$/i });
      if (await working.count()) {
        await working.first().click();
        await page.waitForTimeout(1500);
        await ackScopeIfNeeded();
        await dismissBlockingAlerts();
        if (await page.getByRole("button", { name: /^Start Working$/i }).count()) {
          await page.getByRole("button", { name: /^Start Working$/i }).first().click();
          await page.waitForTimeout(1500);
          await ackScopeIfNeeded();
          await dismissBlockingAlerts();
        }
        log("tech_working", "pass", "Start Working");
      } else {
        await ackScopeIfNeeded();
        await dismissBlockingAlerts();
        log("tech_working", "skip", "Already past Working");
      }

      await dismissBlockingAlerts();
      await page.waitForTimeout(1000);

      // Prefer sticky CTA; fall back to enabled checklist Complete
      let completeClicked = false;
      const completeSticky = page.getByRole("button", { name: "Complete (customer sign-off)" });
      if ((await completeSticky.count()) && (await completeSticky.isEnabled())) {
        await completeSticky.click();
        completeClicked = true;
      } else {
        // Checklist grid Complete (enabled only when step === complete)
        const checklistComplete = page
          .locator("section[aria-labelledby='checklist-heading'] button")
          .filter({ hasText: /^Complete$/ });
        if ((await checklistComplete.count()) && (await checklistComplete.first().isEnabled())) {
          await checklistComplete.first().click();
          completeClicked = true;
        } else {
          // Last resort: any enabled button whose accessible name is exactly Complete
          const anyComplete = page.getByRole("button", { name: /^Complete$/, exact: true });
          for (let i = 0; i < (await anyComplete.count()); i++) {
            if (await anyComplete.nth(i).isEnabled()) {
              await anyComplete.nth(i).click();
              completeClicked = true;
              break;
            }
          }
        }
      }

      if (!completeClicked) {
        await shot(page, "05b-no-complete-cta");
        const bodyNow = await page.locator("body").innerText();
        log(
          "tech_complete",
          "fail",
          `Complete CTA missing. Snippet: ${bodyNow.slice(0, 500).replace(/\s+/g, " ")}`,
        );
        throw new Error("Complete (customer sign-off) not available");
      }
      await page.waitForTimeout(1500);

      // Wait for Customer sign-off dialog (runComplete may take a moment for labor finalize)
      const signOffTitle = page.getByRole("heading", { name: /Customer sign-off/i });
      try {
        await signOffTitle.waitFor({ state: "visible", timeout: 30000 });
      } catch {
        await shot(page, "05c-no-signoff");
        const bodyNow = await page.locator("body").innerText();
        log(
          "tech_complete",
          "fail",
          `Sign-off dialog missing. Snippet: ${bodyNow.slice(0, 600).replace(/\s+/g, " ")}`,
        );
        throw new Error("Customer sign-off dialog did not open");
      }

      // Method toggle inside dialog (not the tab — tab is "Initials / Signature")
      const dialog = page.getByRole("dialog");
      const initialsMethod = dialog.getByRole("button", { name: /^Initials$/i });
      if (await initialsMethod.count()) {
        await initialsMethod.click();
        await page.waitForTimeout(400);
      }

      const initialsField = dialog.getByPlaceholder("JD");
      if (await initialsField.count()) {
        await initialsField.fill("E2");
      } else {
        await dialog.locator('input.input').first().fill("E2");
      }
      const saveInit = dialog.getByRole("button", { name: /Save initials/i });
      if (await saveInit.count()) {
        await saveInit.click();
        await page.waitForTimeout(800);
      }

      await dialog.getByRole("button", { name: /Submit sign-off & complete/i }).click();
      await page.waitForTimeout(4000);
      await shot(page, "06-tech-completed");

      const err = page.locator(".alert-error, [role='alert'].alert-error");
      if ((await err.count()) && (await err.first().isVisible())) {
        const t = await err.first().innerText();
        log("tech_complete", "fail", t.slice(0, 400));
        throw new Error(`Tech complete failed: ${t}`);
      }
      log("tech_complete", "pass", `${ids.woNumber} completed with customer sign-off`);
      // No manager approval needed on My Day complete path
      log("manager_approve", "skip", "Not required — tech sign-off completes WO directly");
      await logout(page, context);
    }

    // ── 4) Billing: create & send → pay ──────────────────────────────────
    await login(page, "billing@equipmentiq-demo.test");
    log("login_billing", "pass", "billing@equipmentiq-demo.test");

    await page.goto(`${BASE}/billing`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await shot(page, "07-billing-ready");

    const readyBtns = page
      .locator("button")
      .filter({ hasText: ids.woNumber ? new RegExp(ids.woNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : /WO-\d+/ });
    let foundReady = false;
    const readyCount = await readyBtns.count();
    for (let i = 0; i < readyCount; i++) {
      const txt = await readyBtns.nth(i).innerText();
      if (!ids.woNumber || txt.includes(ids.woNumber)) {
        await readyBtns.nth(i).click();
        foundReady = true;
        break;
      }
    }
    if (!foundReady) {
      // WO detail invoice path
      await page.goto(`${BASE}/work-orders/${ids.woId}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      const invJob = page.getByRole("button", { name: /Create & send invoice|Invoice job/i });
      if (await invJob.count()) {
        await invJob.first().click();
        foundReady = true;
      } else {
        await shot(page, "07b-wo-not-ready");
        const statusText = await page.locator("body").innerText();
        log(
          "billing_select_wo",
          "fail",
          `${ids.woNumber} not in Ready to invoice. Snippet: ${statusText.slice(0, 400).replace(/\s+/g, " ")}`,
        );
        throw new Error("WO not ready to invoice");
      }
    } else {
      log("billing_select_wo", "pass", ids.woNumber);
    }

    await page.waitForTimeout(2500);
    const previewText = await page.locator("body").innerText();
    // Preview panel uses "Total" on its own line above "$xx.xx"
    const totalMatch =
      previewText.match(/Labor[^\n]*\$([\d,]+\.\d{2})/i) ||
      previewText.match(/Total\s*\n?\s*\$([\d,]+\.\d{2})/i) ||
      previewText.match(/Subtotal\s*\n?\s*\$([\d,]+\.\d{2})/i);
    const previewTotal = totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : 0;
    ids.invoiceTotal = previewTotal;
    if (previewTotal <= 0) {
      await shot(page, "07c-zero-preview");
      log("create_invoice", "fail", `Preview total is $0 for ${ids.woNumber} — labor may be missing`);
      throw new Error("Zero-dollar invoice preview");
    }
    log("invoice_preview_amount", "pass", `total≈$${previewTotal.toFixed(2)}`);

    const createSend = page.getByRole("button", { name: /create & send|create and send/i });
    if (!(await createSend.count())) {
      await shot(page, "07d-no-create");
      log("create_invoice", "fail", "No Create & send button");
      throw new Error("No create invoice button");
    }
    await createSend.first().click();
    await page.waitForURL(/\/billing\/[0-9a-f-]+/i, { timeout: 45000 }).catch(() => null);
    await page.waitForTimeout(2000);
    await shot(page, "08-invoice-created");

    const invUrl = page.url();
    const m = invUrl.match(/\/billing\/([0-9a-f-]+)/i);
    ids.invoiceId = m?.[1] ?? null;
    const invPageText = await page.locator("body").innerText();
    ids.invoiceNumber = invPageText.match(/INV-\d+/)?.[0] ?? null;

    const createErr = page.locator(".alert-error");
    if ((await createErr.count()) && (await createErr.first().isVisible())) {
      log("create_invoice", "fail", await createErr.first().innerText());
      throw new Error("Invoice create error");
    }

    if (ids.invoiceId || ids.invoiceNumber) {
      log(
        "create_invoice",
        "pass",
        `${ids.invoiceNumber || "unknown"} id=${ids.invoiceId || "n/a"} from ${ids.woNumber}`,
      );
    } else {
      log("create_invoice", "fail", `URL=${invUrl}`);
      throw new Error("Invoice not created");
    }

    // Record payment
    const payHref = ids.invoiceId ? `${BASE}/payments?invoice=${ids.invoiceId}` : `${BASE}/payments`;
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
        (ids.invoiceNumber && options.find((o) => o.includes(ids.invoiceNumber))) || null;
      if (!target) {
        await shot(page, "09a-invoice-not-in-ar");
        log(
          "record_payment",
          "fail",
          `${ids.invoiceNumber} not in payment dropdown (may be $0 / not open AR). Options: ${options.slice(0, 8).join(" | ")}`,
        );
        throw new Error("Created invoice not in open AR list");
      }
      const value = await selectInDialog
        .locator("option", { hasText: target })
        .first()
        .getAttribute("value");
      if (value) await selectInDialog.selectOption(value);
    }

    const amountInput = dialog.locator('input[type="number"]').first();
    if (await amountInput.count()) {
      const amt = await amountInput.inputValue();
      ids.paymentAmount = amt;
      if (!amt || Number(amt) <= 0) {
        log("record_payment", "fail", "Payment amount empty/zero");
        throw new Error("No payment amount");
      }
      log("payment_amount", "pass", `amount=${amt}`);
    }

    const refInputs = dialog.locator("input.input, input[type='text']");
    if (await refInputs.count()) {
      await refInputs.last().fill(`E2E-FULL-C2C-${Date.now()}`);
    }

    await dialog.getByRole("button", { name: /save payment/i }).click();
    await page.waitForTimeout(3000);
    await shot(page, "09-payment-recorded");

    const payErr = page.locator(".alert-error");
    if ((await payErr.count()) && (await payErr.first().isVisible())) {
      log("record_payment", "fail", await payErr.first().innerText());
      throw new Error("Payment form error");
    }
    log("record_payment", "pass", `Payment submitted for ${ids.invoiceNumber || ids.invoiceId}`);

    // Verify invoice Paid
    if (ids.invoiceId) {
      await page.goto(`${BASE}/billing/${ids.invoiceId}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      await shot(page, "10-invoice-after-payment");
      const after = await page.locator("body").innerText();
      const statusPaid = /\bStatus\b[^\n]*\bPaid\b/i.test(after) || /\bPaid\b/.test(after);
      const zeroRemain =
        /Balance due[^\n]*\$0\.00/i.test(after) ||
        /remaining[^\n$]*\$0\.00/i.test(after);
      const totalPositive = !/Invoice total[^\n]*\$0\.00/i.test(after);
      if (statusPaid && zeroRemain && totalPositive) {
        log("verify_invoice_paid", "pass", "Invoice shows Paid / $0 remaining with non-zero total");
      } else if (zeroRemain && !totalPositive) {
        log(
          "verify_invoice_paid",
          "fail",
          `Invoice is $0 total (looks paid but no charges). Status snippet: ${after.slice(0, 400).replace(/\s+/g, " ")}`,
        );
      } else if (/partial/i.test(after)) {
        log("verify_invoice_paid", "pass", "Invoice shows Partial");
      } else {
        log(
          "verify_invoice_paid",
          "fail",
          `Could not confirm paid. Snippet: ${after.slice(0, 400).replace(/\s+/g, " ")}`,
        );
      }
    }

    // Verify WO billed via WO page
    await page.goto(`${BASE}/work-orders/${ids.woId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await shot(page, "11-wo-after-billing");
    const woText = await page.locator("body").innerText();
    if (/\bBilled\b/i.test(woText)) {
      log("verify_wo_billed", "pass", `${ids.woNumber} billing_status Billed`);
    } else {
      log(
        "verify_wo_billed",
        "fail",
        `WO page missing Billed. Snippet: ${woText.slice(0, 400).replace(/\s+/g, " ")}`,
      );
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
    const summary = { ids, steps, artifacts: OUT };
    console.log("---SUMMARY---");
    console.log(JSON.stringify(summary, null, 2));
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
    const failed = steps.some((s) => s.status === "fail");
    process.exit(failed ? 1 : 0);
  }
}

main();
