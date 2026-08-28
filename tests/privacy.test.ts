import assert from "node:assert/strict";
import test from "node:test";

import { findPrivacyIssues, redactPrivacyText } from "../lib/privacy";

test("blocks personal contact and street-address details before AI generation", () => {
  const issues = findPrivacyIssues({
    situation: "Email maria.lopez@personalmail.com or call 415-867-5309 about 3948 Simpson Road.",
  });

  assert.deepEqual(issues.map((issue) => issue.code).sort(), [
    "email_address",
    "phone_number",
    "street_address",
  ]);
  assert.ok(issues.every((issue) => issue.path === "situation"));
});

test("allows reserved fictional contact placeholders used by the Scenario Factory", () => {
  assert.deepEqual(findPrivacyIssues({
    revealOnlyWhenAsked: ["Email: maria.lopez@example.com", "Phone: 555-0134", "Address: 123 Example Street"],
  }), []);
});

test("blocks service identifiers, payment last-four, and URLs", () => {
  const issues = findPrivacyIssues({
    orderId: "AB12345678",
    accountNumber: "CUST-778899",
    trackingNumber: "1Z999AA10123456784",
    rxNumber: "RX-123456",
    paymentLastFour: "9876",
    serviceLocator: "https://internal.example.test/private",
  });

  assert.deepEqual(issues.map((issue) => [issue.code, issue.path]), [
    ["service_identifier", "orderId"],
    ["service_identifier", "accountNumber"],
    ["service_identifier", "trackingNumber"],
    ["service_identifier", "rxNumber"],
    ["payment_last_four", "paymentLastFour"],
    ["url", "serviceLocator"],
  ]);
});

test("blocks compact contact details and cloud/service locator variants", () => {
  const issues = findPrivacyIssues({
    compactPhone: "4155551212",
    countryPhone: "+14155551212",
    orderNo: "AB12345678",
    trackingNo: "1Z999AA10123456784",
    paymentLast4: "9876",
    cardLast4: "4321",
    s3Uri: "s3://private-bucket/customer-record.json",
    secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:pilot",
    signedQuery: "X-Amz-Signature=abcdef123456",
  });

  assert.deepEqual(issues.map((issue) => [issue.code, issue.path]), [
    ["phone_number", "compactPhone"],
    ["phone_number", "countryPhone"],
    ["service_identifier", "orderNo"],
    ["service_identifier", "trackingNo"],
    ["payment_last_four", "paymentLast4"],
    ["payment_last_four", "cardLast4"],
    ["service_locator", "s3Uri"],
    ["service_locator", "secretArn"],
    ["service_locator", "signedQuery"],
  ]);
});

test("blocks identifiers and address variants embedded in ordinary text", () => {
  const issues = findPrivacyIssues({
    address: "Ship to 123 Main Way",
    orderSentence: "Order AB12345678 is delayed",
    accountSentence: "Account ACCT778899 needs help",
    embeddedJson: '{"order_id":"AB12345678"}',
    bareTracking: "1Z999AA10123456784",
  });

  assert.deepEqual(issues.map((issue) => [issue.code, issue.path]), [
    ["street_address", "address"],
    ["service_identifier", "orderSentence"],
    ["service_identifier", "accountSentence"],
    ["service_identifier", "embeddedJson"],
    ["service_identifier", "bareTracking"],
  ]);
});

test("allows fictional, de-identified conversation details", () => {
  assert.deepEqual(findPrivacyIssues({
    situation: "A pet parent calls because a delayed food order is expected tomorrow.",
    learnerGoal: "Set expectations without guaranteeing delivery.",
  }), []);
});

test("allows exact sensitive-looking values already present in an imported scenario", () => {
  const imported = {
    facts: { address: "123 Main Street" },
    owner: { email: "creator@personalmail.com" },
  };

  assert.deepEqual(findPrivacyIssues({
    compatibilityFacts: { address: "123 Main Street" },
    guidance: "Confirm 123 Main Street before updating the order.",
    owner: { email: "creator@personalmail.com" },
  }, { allowFrom: imported }), []);

  assert.deepEqual(findPrivacyIssues({
    compatibilityFacts: { address: "987 New Road" },
    owner: { email: "different@personalmail.com" },
  }, { allowFrom: imported }).map((issue) => issue.code).sort(), ["email_address", "street_address"]);
});

test("detects private values stored as numbers or object keys", () => {
  const issues = findPrivacyIssues({
    orderId: 123456789,
    nested: { "person@personalmail.com": "hidden in a key" },
  });

  assert.deepEqual(issues.map((issue) => [issue.code, issue.path]), [
    ["service_identifier", "orderId"],
    ["email_address", "nested.[object-key]"],
  ]);
});

test("redacts only the sensitive fragment when Similar mode must retain source context", () => {
  const redacted = redactPrivacyText("Confirm the delivery change to 3948 Simpson Road before saving order AB12345678.");

  assert.equal(redacted, "Confirm the delivery change to [fictional address] before saving [fictional service identifier].");
  assert.deepEqual(findPrivacyIssues(redacted), []);
});
