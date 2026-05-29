export const metadata = {
  title: 'Terms of Service — Invoice Platform',
  description: 'Terms and conditions for using Invoice Platform.',
};

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12 text-sm leading-relaxed text-gray-800">
      <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-gray-500 mb-10">Last updated: 29 May 2026</p>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">1. Acceptance</h2>
        <p>
          By accessing or using Invoice Platform (&ldquo;Service&rdquo;), operated by Dev Company OÜ
          (&ldquo;Company&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), you agree to these Terms of Service. If you are
          accepting on behalf of a company, you represent that you have authority to bind that entity.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">2. Service Description</h2>
        <p className="mb-3">
          Invoice Platform is a cloud-based invoicing solution that provides:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>EN 16931 compliant invoice creation, PDF generation, and Peppol UBL XML export</li>
          <li>Company registry lookup for EU member states</li>
          <li>AI-assisted invoice review and dunning message generation (via Anthropic Claude API)</li>
          <li>Cloud archive synchronisation (Google Drive, Dropbox, OneDrive)</li>
          <li>Invoice email delivery via Resend</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">3. Accounts and Access</h2>
        <ul className="list-disc pl-6 space-y-2 text-gray-700">
          <li>You must provide accurate registration information and keep credentials confidential.</li>
          <li>You are responsible for all activity under your account.</li>
          <li>We reserve the right to suspend accounts that breach these Terms or applicable law.</li>
          <li>API keys are tenant-scoped; do not share production keys publicly.</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">4. Acceptable Use</h2>
        <p className="mb-3">You agree not to use the Service to:</p>
        <ul className="list-disc pl-6 space-y-1 text-gray-700">
          <li>Generate fraudulent, forged, or misleading invoices</li>
          <li>Transmit malware, spam, or unsolicited commercial communications</li>
          <li>Circumvent rate limits, access controls, or security features</li>
          <li>Process data of minors or special-category personal data (GDPR Art. 9)</li>
          <li>Violate any applicable law, regulation, or third-party rights</li>
        </ul>
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded p-4 text-amber-900 text-xs">
          <strong>B2G / Regulated Use:</strong> The Service is not certified for Peppol
          Business-to-Government (B2G) or regulated-sector use. Do not submit invoices to public
          sector buyers via this Service without verifying compliance with applicable national
          e-invoicing mandates.
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">5. Subscription and Payment</h2>
        <ul className="list-disc pl-6 space-y-2 text-gray-700">
          <li>Plans are billed monthly in advance. Prices are shown excluding VAT.</li>
          <li>Overages (AI spend, invoice volume) are billed at end of month.</li>
          <li>No refunds are issued for partial months unless required by applicable law.</li>
          <li>We reserve the right to change pricing with 30 days&rsquo; written notice.</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">6. Data and Privacy</h2>
        <p>
          Our processing of personal data is governed by our{' '}
          <a href="/legal/privacy" className="underline text-blue-700">Privacy Policy</a>, which forms
          part of these Terms. We act as a data processor for your customer and invoice data and
          as a data controller for account data.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">7. Intellectual Property</h2>
        <p className="mb-3">
          The Service software, branding, and documentation are owned by Dev Company OÜ and
          licensed to you for use during the subscription term only.
        </p>
        <p>
          You retain ownership of all invoice data, company data, and documents you create or
          upload. You grant us a limited licence to process this data solely to provide the
          Service.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">8. Service Availability and SLA</h2>
        <ul className="list-disc pl-6 space-y-2 text-gray-700">
          <li>We target 99.5% monthly uptime for the API and web application, excluding scheduled maintenance.</li>
          <li>We do not guarantee availability of third-party integrations (PRH, Äriregister, Anthropic, Resend).</li>
          <li>Scheduled maintenance will be announced at least 24 hours in advance via the status page.</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">9. Limitation of Liability</h2>
        <p className="mb-3">
          To the maximum extent permitted by law, the Company&apos;s total liability for any claim
          arising from the Service shall not exceed the subscription fees paid by you in the
          three months preceding the claim.
        </p>
        <p>
          We are not liable for indirect, consequential, or punitive damages, or for the accuracy
          of AI-generated content, company registry data, or third-party tax advice.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">10. Termination</h2>
        <p>
          Either party may terminate at end of a billing period. Upon termination, you may
          export your data for 30 days, after which it will be deleted (subject to legal retention
          obligations).
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">11. Governing Law</h2>
        <p>
          These Terms are governed by Estonian law. Disputes shall be resolved in the courts of
          Tallinn, Estonia, unless mandatory consumer protection law requires otherwise.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">12. Contact</h2>
        <p>
          Legal notices:{' '}
          <a href="mailto:legal@invoiceplatform.eu" className="underline">legal@invoiceplatform.eu</a>
          <br />
          Dev Company OÜ, Tartu mnt 16, 10115 Tallinn, Estonia
        </p>
      </section>

      <hr className="border-gray-200 mb-6" />
      <p className="text-xs text-gray-400">
        These Terms supersede all prior agreements relating to the Service.
        Continued use after a Terms update constitutes acceptance of the revised Terms.
      </p>
    </main>
  );
}
