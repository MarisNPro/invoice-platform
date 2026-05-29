export const metadata = {
  title: 'Privacy Policy — Invoice Platform',
  description: 'How Invoice Platform collects, processes, and protects your data under GDPR.',
};

export default function PrivacyPolicyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12 text-sm leading-relaxed text-gray-800">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-gray-500 mb-10">Last updated: 29 May 2026</p>

      {/* 1. Data controller */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">1. Data Controller</h2>
        <p>
          The data controller for all personal data processed through Invoice Platform is:
        </p>
        <address className="not-italic mt-3 pl-4 border-l-2 border-gray-200 text-gray-700">
          <strong>Dev Company OÜ</strong><br />
          Tartu mnt 16, 10115 Tallinn, Estonia<br />
          VAT: EE123456789<br />
          Email: <a href="mailto:privacy@invoiceplatform.eu" className="underline">privacy@invoiceplatform.eu</a>
        </address>
      </section>

      {/* 2. What we collect */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">2. What Data We Collect</h2>
        <p className="mb-3">
          We collect and process the following categories of data when you use Invoice Platform:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li><strong>Account data:</strong> email address, name, password hash (via Keycloak)</li>
          <li><strong>Invoice data:</strong> invoice numbers, dates, line items, amounts, payment status</li>
          <li><strong>Company data:</strong> company names, VAT numbers, business registration numbers, addresses</li>
          <li><strong>Contact data:</strong> customer and supplier names, email addresses, IBAN/BIC payment details</li>
          <li><strong>Usage data:</strong> audit log entries, IP addresses, timestamps of actions</li>
          <li><strong>Financial data:</strong> invoice totals, tax amounts, payment records</li>
        </ul>
        <p className="mt-3 text-gray-600">
          We do not collect sensitive personal data (health, biometric, or political data).
        </p>
      </section>

      {/* 3. How we process it */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">3. How We Process Your Data</h2>
        <p className="mb-3">
          Your data is processed on the following legal bases (GDPR Art. 6):
        </p>
        <ul className="list-disc pl-6 space-y-2 text-gray-700">
          <li>
            <strong>Contract performance (Art. 6(1)(b)):</strong> Processing necessary to provide
            invoice creation, PDF generation, Peppol UBL export, and email delivery.
          </li>
          <li>
            <strong>Legal obligation (Art. 6(1)(c)):</strong> Retention of invoices for tax and
            accounting compliance (7 years under Estonian Accounting Act §12).
          </li>
          <li>
            <strong>Legitimate interests (Art. 6(1)(f)):</strong> Audit logging for security,
            system health monitoring, and fraud prevention.
          </li>
        </ul>
        <p className="mt-4 text-gray-700">
          <strong>Storage location:</strong> All primary data is stored in{' '}
          <strong>Supabase (AWS eu-central-1, Frankfurt, Germany)</strong> — within the European
          Union. Redis cache data is stored in{' '}
          <strong>Upstash (EU-Central-1, Frankfurt)</strong>.
        </p>
      </section>

      {/* 4. AI processing */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">4. AI-Assisted Features</h2>
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-amber-900 mb-4 text-xs">
          <strong>Note on cross-border data transfer:</strong> AI features involve data transfer
          to the United States under the safeguards described below.
        </div>
        <p className="mb-3">
          Invoice Platform uses the <strong>Anthropic Claude API</strong> to power the following
          optional features:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-gray-700 mb-3">
          <li>EN 16931 compliance review of invoice content</li>
          <li>AI-generated dunning (payment reminder) messages</li>
        </ul>
        <p className="mb-3">
          When you use these features, invoice metadata (amounts, dates, company names, VAT
          numbers, line descriptions) is transmitted to Anthropic&apos;s API servers located in the
          United States.
        </p>
        <p className="mb-3">
          <strong>Legal basis for transfer:</strong> Data is transferred under{' '}
          <strong>Standard Contractual Clauses (SCCs)</strong> pursuant to the Anthropic Data
          Processing Agreement (DPA) effective January 2026. A copy of the DPA is available at{' '}
          <a href="https://www.anthropic.com/legal/dpa" className="underline text-blue-700" target="_blank" rel="noopener noreferrer">
            anthropic.com/legal/dpa
          </a>.
        </p>
        <p className="font-medium text-gray-800">
          Anthropic does not use API input or output data to train its models. Your invoice data
          is used solely to generate the requested AI response and is not retained by Anthropic
          beyond the API request lifecycle.
        </p>
      </section>

      {/* 5. Cowork / B2G notice */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">5. Workflow Limitations</h2>
        <div className="bg-red-50 border border-red-200 rounded p-4 text-red-900 text-xs">
          <strong>Important:</strong> Cowork workflows are not covered by audit logs. Do not use
          Invoice Platform for Peppol B2G (Business-to-Government) submissions or any
          regulated-sector data (healthcare, defence, financial services) where audit trail
          completeness is a compliance requirement.
        </div>
      </section>

      {/* 6. Your rights */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">6. Your Rights (GDPR)</h2>
        <p className="mb-3">
          Under the General Data Protection Regulation (GDPR), you have the following rights:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-gray-700">
          <li><strong>Access (Art. 15):</strong> Request a copy of all personal data we hold about you.</li>
          <li><strong>Rectification (Art. 16):</strong> Correct inaccurate or incomplete data.</li>
          <li><strong>Erasure (Art. 17):</strong> Request deletion of your data where no legal retention obligation applies.</li>
          <li><strong>Portability (Art. 20):</strong> Receive your invoice and account data in a machine-readable format (JSON / CSV).</li>
          <li><strong>Restriction (Art. 18):</strong> Request that we restrict processing of your data while a dispute is resolved.</li>
          <li><strong>Object (Art. 21):</strong> Object to processing based on legitimate interests.</li>
          <li><strong>Withdraw consent (Art. 7(3)):</strong> Where processing is consent-based, withdraw at any time.</li>
        </ul>
        <p className="mt-4 text-gray-700">
          To exercise any of these rights, contact us at{' '}
          <a href="mailto:privacy@invoiceplatform.eu" className="underline">privacy@invoiceplatform.eu</a>.
          We will respond within 30 days. You also have the right to lodge a complaint with the
          Estonian Data Protection Inspectorate (
          <a href="https://www.aki.ee" className="underline" target="_blank" rel="noopener noreferrer">aki.ee</a>
          ) or your local supervisory authority.
        </p>
      </section>

      {/* 7. Contact */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">7. Contact</h2>
        <p className="text-gray-700">
          For privacy questions, data subject requests, or DPA enquiries:
        </p>
        <ul className="mt-3 space-y-1 text-gray-700">
          <li>Email: <a href="mailto:privacy@invoiceplatform.eu" className="underline">privacy@invoiceplatform.eu</a></li>
          <li>Post: Dev Company OÜ, Tartu mnt 16, 10115 Tallinn, Estonia</li>
        </ul>
      </section>

      <hr className="border-gray-200 mb-6" />
      <p className="text-xs text-gray-400">
        This policy applies to Invoice Platform SaaS product. It does not apply to our marketing
        website or any third-party integrations beyond those described above.
      </p>
    </main>
  );
}
