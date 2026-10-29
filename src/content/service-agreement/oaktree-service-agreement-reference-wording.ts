/**
 * Controlled wording of the Oaktree Local Master Services Agreement as the
 * firm uses it today (reference agreement reviewed on 27 September 2026).
 *
 * The text is copied exactly, except for the slips the firm approved
 * correcting on 27 September 2026; REFERENCE_WORDING_CORRECTIONS records each
 * one against the wording it replaced.
 * Inline `**bold**` marks the defined terms the reference sets in bold.
 */

export interface ReferenceTermsGroup {
  number: string;
  heading: string;
  clauses: ReadonlyArray<readonly [number: string, text: string]>;
}

export const REFERENCE_COVER = {
  confidentiality: 'Private and confidential',
  title: 'Local Master Services Agreement',
  paragraphs: [
    'Thank you for appointing OakTree Accounting and Corporate Solutions (“**Oaktree**” or “**we**”) to provide services to the company listed in Appendix 3 (“**Client**” or “**you**”) on terms set out in this Local Master Services Agreement (this “**Agreement**”), which include the Terms of Business set out in Appendix 1.',
    'Unless the context requires otherwise, all terms defined in the Terms of Business shall have the same meaning when used herein.',
    'We will provide the services (the “**Services**”) set out in each Statement of Work (substantially in the format as set out in Appendix 2) signed between Oaktree and you and issued hereunder. Each Statement of Work (i) shall be deemed to include all the terms and provisions of this Agreement; and (ii) together with the terms set out in this Agreement, which are deemed to be included, shall form a separate contract between the parties thereto. Any amendments to each Statement of Work shall be set out in an Addendum and signed by both parties.',
    'In case of any conflict between the provisions of any Addendum, a Statement of Work and this Agreement, the order or priority shall be as follows (unless expressly agreed otherwise): (i) the latest Addendum for specific amendment(s) to each Statement of Work; (ii) the relevant Statement of Work; and (iii) this Agreement. For the avoidance of doubt, the provisions set out in any Addendum and the relevant Statement of Work shall prevail but only for the purposes of that particular Statement of Work. Services will be performed in such manner, at such place or places, and on such further terms as may be agreed in the relevant Statement of Work or as otherwise varied by any Addenda from time to time.',
    'Please record your agreement to the terms of this Agreement by signing the enclosed copy of this letter in the space provided and returning it to us.',
  ],
  closing: 'Yours faithfully',
  providerSigningLabel: 'Signed for and on behalf of',
} as const;

/**
 * The firm's name is fixed; the signatory's name is the preparer's, filled in
 * at generation. The appointment line stays fixed because users carry no
 * job title yet.
 */
export const REFERENCE_PROVIDER = {
  legalName: 'Oaktree Accounting and Corporate Solutions Pte Ltd',
  signatoryRole: 'Director',
} as const;

export const REFERENCE_ACCEPTANCE = {
  appendices: [
    'Appendix 1 – Terms of Business',
    'Appendix 2 – Statement of Work',
    'Appendix 3 – List of Client entities within this Agreement',
  ],
  title: 'Confirmation of Acceptance',
  statement: 'I have read the terms set out in this Agreement and accept the terms and represent that I am authorised for and on behalf of the entities listed in Appendix 3 to do so.',
  clientSigningLabel: 'Signed for and on behalf of Client',
} as const;

export const REFERENCE_TERMS_TITLE = 'Appendix 1 Terms of Business';

export const REFERENCE_TERMS: readonly ReferenceTermsGroup[] = [
  {
    number: '1',
    heading: 'Our Services',
    clauses: [
      ['1.1', 'We will perform the Services set out in each Statement of Work issued hereunder with reasonable skill and care.'],
      ['1.2', 'The Services provided by us may include advice and recommendations, but all decisions in respect of the implementation of such advice and recommendations shall be your responsibility.'],
      ['1.3', 'We will act in accordance with all your instructions and shall have no duty to verify or review the accuracy, propriety or legality of the instructions. We shall be entitled to disregard or refuse to act on any instruction which we reasonably believe may not be compliant with applicable laws without being liable to you.'],
      ['1.4', 'We will use our best effort to meet the timetable set out in the relevant Statement of Work. However, unless expressly agreed in writing, dates contained in the relevant Statement of Work or otherwise communicated are indicative dates intended for planning only.'],
      ['1.5', 'Deliverables to be provided by us under the relevant Statement of Work (“Deliverables”) and the Services are provided solely for your use for the purposes set out in the relevant Statement of Work or Deliverable. You may not disclose any Deliverable to any third party or refer to us in connection with the Services except: (i) as required by law (and you will promptly notify us of such legal requirement to the extent you are permitted to do so), or (ii) with our prior written consent and on such conditions which we have specified in our consent.'],
      ['1.6', 'While the software platforms to be used for accounting and payroll services may be specified in the Statement of Work, the Firm reserves the right to change, upgrade, or substitute such software or technology tools at its discretion. These changes will be implemented with due care and shall not materially affect the quality, scope, or timeliness of the services. The Client will be notified in advance of any significant changes.'],
      ['1.7', 'You acknowledge that you will not rely on any draft Deliverables or oral advice.'],
    ],
  },
  {
    number: '2',
    heading: 'Your responsibilities',
    clauses: [
      ['2.1', 'You agree to: (i) provide us promptly all information, resources and assistance (including access to records, systems, premises and people) that we reasonably require to perform the Services; (ii) ensure that all information provided by you or on your behalf (“Client Information”) will be accurate and complete in all material respects and will not infringe any copyright or other third-party rights; and (iii) alert us to changes to any Client Information.'],
      ['2.2', 'You acknowledge that we will rely on the Client Information and will not evaluate or verify any Client Information.'],
      ['2.3', 'You agree that all instructions given by you shall comply with all applicable law and regulations.'],
      ['2.4', 'You agree to provide all information necessary for us to fulfill our anti-money laundering and know-your-client obligations under applicable laws and regulations. If changes in laws or regulations materially affect our ability to provide the Services or increase the cost of doing so, we may adjust the scope, fees, or terms of this Agreement upon written notice to you.'],
    ],
  },
  {
    number: '3',
    heading: 'Confidentiality',
    clauses: [
      ['3.1', 'Both parties agree to use all confidential information in relation to the Services only and not to disclose to third parties the contents of this Agreement, any Statement of Work, or any confidential information. Either of us may, however, disclose such information to the extent that: (i) it is or becomes public other than through a breach of this Agreement, (ii) it is subsequently received by the recipient from a third party who, to the recipient’s knowledge, owes no obligation of confidentiality to the disclosing party with respect to that information, (iii) it was known to the recipient at the time of disclosure or is thereafter created independently, or (iv) it must be disclosed under applicable law, legal process or professional regulations.'],
      ['3.2', 'We may provide Client Information to other entities within Oaktree or relevant subcontractors as long as they are bound by confidentiality obligations and to the extent it is not prohibited by applicable law.'],
    ],
  },
  {
    number: '4',
    heading: 'Personal Data Protection',
    clauses: [
      ['4.1', 'We will process personal data provided by you under this Agreement or any Statement of Work (“Personal Data”) in accordance with applicable data protection requirements including (without limitation) to the Personal Data Protection Act 2012 of Singapore.'],
      ['4.2', 'You agree that we may share Personal Data with other Oaktree entities and other relevant subcontractors (who may be located in other territories) for the purposes of (i) providing the Services, (ii) maintaining our operations or client relationship management system, (iii) risk management, or (iv) providing you with information about us and our range of services.'],
      ['4.3', 'You warrant that you have the authority to provide Personal Data to us and that any personal data provided to us has been processed in accordance with applicable law.'],
    ],
  },
  {
    number: '5',
    heading: 'Intellectual Property Rights',
    clauses: [
      ['5.1', 'We will own the intellectual property rights in the Deliverables, work paper we compiled in relation to the provision of the Services, and any material created under this Agreement and/or any Statement of Work.'],
      ['5.2', 'Subject to the payment of all fees set out in the Statement of Work, you will have a non-exclusive, non-transferable license to use all Deliverables in accordance with Clause 1.5.'],
    ],
  },
  {
    number: '6',
    heading: 'Liability',
    clauses: [
      ['6.1', 'Our liability for loss or damages arising in relation to the Services, as a result of breach of contract, tort (including negligence) or otherwise, is limited to one times the fees paid by you for the relevant Services that directly caused the loss or damages, except to the extent to which we are finally determined to have engaged in willful misconduct or fraudulent behaviour.'],
      ['6.2', 'To the extent permitted by applicable law, we will not be liable for any loss, damage or expenses, not directly caused by our wrongdoing (including loss of profits or revenue, business interruption, loss or corruption of data, loss of business opportunity, or failure to realise anticipated savings or benefits) arising in any way in relation to the Services.'],
      ['6.3', 'The amount of our liability (if any) shall be limited to that proportion of the total damage, after taking into account the responsibility of all who contributed to your loss.'],
      ['6.4', 'Where we agree in writing to accept liability to more than one party, the limit on our liability in Clause 6.1 will be shared between them, and it is up to the parties how they share it.'],
      ['6.5', 'We accept no liability to anyone, other than you, in connection with the Services, unless otherwise agreed by us in writing. You agree to reimburse us, other Oaktree entities, directors, employees, and subcontractors for any liability (including legal costs) that any such party in connection with any claim by anyone else in relation to the Services. Your obligation to reimburse will not apply to the extent such claim or action is finally determined to have resulted from fraud or willful misconduct by us, other Oaktree entities, directors, employees, or subcontractors.'],
    ],
  },
  {
    number: '7',
    heading: 'Subcontractors (including other Oaktree entities)',
    clauses: [
      ['7.1', 'We may use other Oaktree entities, related companies or subcontractors to provide the Services. We remain solely responsible for the Services.'],
      ['7.2', 'You agree not to bring any claim (including negligence) against other Oaktree entities in connection with the Services. Any Oaktree entity who deals with you in connection with the Services does so solely on our behalf.'],
      ['7.3', 'Clause 7.2 is for the benefit of other Oaktree entities. You agree that each of the other Oaktree entities may rely on Clause 7.2 as if they were a party to this Agreement. Each other Oaktree entities that assist in providing the Services relies on the protection in Clause 7.2 and we accept its benefit on their behalf.'],
    ],
  },
  {
    number: '8',
    heading: 'Oaktree Individuals',
    clauses: [
      ['8.1', 'You agree not to bring any claim (including negligence) against any of our employees or employees of other Oaktree entities (“Oaktree Individuals”) personally in connection with the Services. This clause is for the benefit of Oaktree Individuals. Each Oaktree Individuals involved in providing the Services relies on the protection in this Clause 8 and we accept its benefit on their behalf.'],
      ['8.2', 'During the term of this Agreement and for 12 months thereafter, you shall not directly or indirectly solicit or employ any of our employees or employees of other Oaktree entities who was involved in providing Services.'],
    ],
  },
  {
    number: '9',
    heading: 'Fees and Payments',
    clauses: [
      ['9.1', 'Fees for the Services will be charged on the basis as set out in the relevant Statement of Work.'],
      ['9.2', 'In the event that the actual time spent on the Services is substantially more than agreed in the relevant Statement of Work, we will mutually agree with you on a revised fee.'],
      ['9.3', 'Unless otherwise stated in the relevant Statement of Work, all fees are exclusive of expenses and we will charge you expenses such as government fees, travel, subsistence, communication and document handling costs (photocopying, printing, fax and courier, etc.).'],
      ['9.4', 'Unless otherwise stated in the relevant Statement of Work, fees for the Services are net of any taxes or similar charges, as well as customs, duties, and tariffs imposed in respect of the Services.'],
      ['9.5', 'All invoices will be due for payment within 30 days of the date of the invoice. If you fail to satisfy (in whole or in part) any undisputed invoice(s) as they fall due, we have the right to suspend or terminate the supply of the Services and/or this Agreement until the outstanding amounts are satisfied, without any liability to you in respect of such suspension or termination. We may also apply a service charge of 1% per month to all amounts not paid to us when due, from its due date to the date of actual payment. We may request advance payment for Services if your financial condition or payment history suggests an increased risk of non-payment.'],
      ['9.6', 'During the term of this Agreement, we may increase the fees for each Service annually (“Annual Adjustment”). We will provide you with prior written notice if the Annual Adjustment is more than 10%.'],
    ],
  },
  {
    number: '10',
    heading: 'Term and Termination',
    clauses: [
      ['10.1', 'This Agreement will commence on the earlier of (i) the date of this Agreement; or (ii) when we begin to provide the Services.'],
      ['10.2', 'This Agreement or any Statement of Work may be terminated or suspended by either party by 30 days’ prior written notice to the other party. In addition, we may terminate this Agreement, or any particular Services, immediately upon written notice to you if we reasonably determine that we can no longer provide the Services in accordance with applicable law or professional obligations. If this Agreement or any Statement of Work is terminated for any reason by any party, we shall not be required to refund all or any part of the annual or any other fees paid under this Agreement or any Statement of Work.'],
      ['10.3', 'You agree to pay us (i) for all Services we performed prior to the termination or suspension; and (ii) a fee based on time spent on the transfer of files and documentations to such third-party service providers as directed by you or such other services we provided as a result of the termination. Upon termination, you shall immediately pay all outstanding fees and expenses incurred up to the date of termination, regardless of whether invoices have been issued.'],
      ['10.4', 'Our respective confidentiality obligations under this Agreement shall continue following the termination of this Agreement. The other provisions of this Agreement which expressly or by implication is intended to survive its termination or expiry will survive and continue to bind the parties.'],
    ],
  },
  {
    number: '11',
    heading: 'General',
    clauses: [
      ['11.1', 'The parties may from time to time communicate with each other electronically. However, electronic transmission of information cannot be guaranteed to be secure or error free and such information could arrive late or incomplete, be intercepted, corrupted, lost, destroyed or otherwise be adversely affected or unsafe to use. Accordingly, each party accepts the limitations of electronic communication and will use reasonable procedures to check for the then most commonly known viruses before sending information electronically.'],
      ['11.2', 'Each of us may execute this Agreement and any Statement of Work hereunder (including any modifications to this Agreement or any Statement of Work) by electronic means.'],
      ['11.3', 'This Agreement constitutes the entire agreement between us as to the Services. It replaces and supersedes all prior agreements, understandings and representations with respect thereto, including any confidentiality agreements previously delivered.'],
      ['11.4', 'Each of us may sign a different copy of the same document. Both of us must agree in writing to modify this Agreement or any Statement of Work hereunder.'],
      ['11.5', 'Neither of us may assign any of our rights, obligations or claims under this Agreement.'],
      ['11.6', 'Neither of us may use or reference the other’s name, logos or trademarks without the other party’s written consent, provided that we may use your name publicly to identify you as a client in connection with specific Services or otherwise.'],
      ['11.7', 'If any provision of this Agreement (in whole or part) is held to be illegal, invalid or otherwise unenforceable, the other provisions shall remain in full force and effect.'],
      ['11.8', 'No party will be liable to another if it fails to meet its obligations due to matters beyond their reasonable control.'],
      ['11.9', 'Except as set out in Clauses 7.2, 7.3, and 8, the Contracts (Rights of Third Parties) Act 2001 shall not apply this Agreement. Any rights conferred on third parties by this Agreement exclude the right to assign, and their consent is not required to rescind or vary this Agreement.'],
    ],
  },
  {
    number: '12',
    heading: 'Force Majeure',
    clauses: [
      ['12.1', 'Neither you nor we shall be liable for breach of this Agreement (other than payment obligations) caused by circumstances beyond your or our reasonable control.'],
    ],
  },
  {
    number: '13',
    heading: 'Governing Law and Dispute Resolution',
    clauses: [
      ['13.1', 'This Agreement, and any non-contractual matters or obligations arising out of this Agreement or the Services, shall be governed by, and construed in accordance with, the laws of Singapore.'],
      ['13.2', 'Except as otherwise expressly provided in the Engagement Letter, disputes relating to this Agreement or the Services shall be submitted to mediation before a mediator chosen by the parties or, where the parties cannot agree, by the Singapore Mediation Centre. If the controversy or claim is not resolved within 90 days (or longer period, as agreed by both parties), the mediation shall terminate and the dispute shall be referred to and finally resolved by arbitration administered by the Singapore International Arbitration Centre (“SIAC”) in accordance with the Arbitration Rules of the SIAC for the time being in force.'],
    ],
  },
];

export const REFERENCE_STATEMENT_OF_WORK = {
  title: 'Appendix 2 Statement of Work',
  /** Split around the client name and effective date fields. */
  opening: [
    'This Statement of Work is signed between Oaktree Accounting and Corporate Solutions Pte Ltd (“**Oaktree**” or “**we**” or “**us**” or “**our**”) and ',
    ' on ',
    ' (the “**Effective Date**”) for the provision of the services set out herein (the “**Services**”). This Statement of Work is issued under the Local Master Services Agreement (the “**Agreement**”). Oaktree and the Client hereby acknowledge and confirm that this Statement of Work and terms of the Agreement shall form a separate contract. All terms set out in the Agreement shall, unless otherwise agreed between the parties herein, apply to this Statement of Work.',
  ],
  paragraphs: [
    'Our Services shall be conducted on the basis that the Client, Client\'s management team and where appropriate, those charged with governance, acknowledge and understand that they have the responsibility to provide the relevant documents at a reasonable timeline to ensure that we have a timely closing.',
    'The Client will be solely responsible to supply us with all information, materials, data, and documents necessary to perform the Services agreed under this Agreement. The Client acknowledges and agrees that the accuracy of financial information supplied to us is the sole responsibility of the Client. We shall not be held responsible for the production of inaccurate financial statements, records, and billings, or any other financial reports if the financial data submitted by the Client is inaccurate.',
  ],
} as const;

export const REFERENCE_FEES = {
  title: 'Fees',
  introduction: 'Fees for the Services are set out below:',
  columns: ['SOW', 'Amount'],
  /** Each fee row is labelled like its scope-of-work heading. */
  sowLabelPrefix: 'Statement of Work – ',
  notes: [
    'Provisions related to fees and payments are set out in Clause 9 of the Terms of Business.',
    'In the event that the actual time spent on the Services is substantially more than agreed in the relevant Statement of Work, we will mutually agree with you on a revised fee.',
    'All fees quoted above are exclusive of any out-of-pocket expenses such as third-party fees, government charges, fines, and penalties unless explicitly specified.',
  ],
} as const;

export const REFERENCE_INSTRUCTIONS = {
  title: 'Instructions',
  introduction: 'All instructions under this Statement of Work shall be given to us (through the email address(es) listed below) by your authorised representative set out below:',
  columns: ['Name', 'Position', 'Email address / Mobile', 'Signature(s)'],
  notes: [
    'Please provide us with the specimen signatures of the authorised representative(s) for our records.',
    'Any changes to the authorised representatives shall be in writing.',
  ],
  variationsTitle: 'Variations to this Statement of Work',
  variations: 'Any variations amending specific provisions to this Statement of Work shall be set out in an Addendum. The terms of the latest Addendum shall take precedence and supersede all prior agreements, understandings and representations in respect of the specific amendments contained in the relevant Addendum.',
  termTitle: 'Term and Termination',
  /** Split around the term field. */
  term: [
    'This Statement of Work shall commence on the Effective Date and shall continue for the period of ',
    ', unless otherwise terminated in accordance with Clause 10.2 of the Agreement.',
  ],
  providerSigningLabel: 'Signed for and on behalf of',
  clientSigningLabel: 'Signed for and on behalf of Client',
} as const;

export const REFERENCE_ENTITY_APPENDIX_TITLE = 'Appendix 3 - List of Client entities within this Agreement';

export const REFERENCE_CORPORATE_SECRETARIAL_SOW = {
  title: 'Statement of Work – Corporate Secretarial Services',
  subsection: 'Corporate Secretarial Services',
  introduction: 'Under the Companies Act, your company must lodge with ACRA all prescribed forms within the stipulated periods, generally 14 days. As such, sufficient time will have to be given to us to prepare the relevant forms.',
  inclusions: [
    'Drafting resolution of directors to approve annual financial statements;',
    'Notifying you of deadlines for holding annual general meetings (AGM);',
    'Preparing annual returns and other secretarial documents for the holding of AGM;',
    'Filing annual returns with ACRA;',
    'Maintaining and posting of your minute books; and',
    'Maintaining statutory registers:',
  ],
  registers: [
    'Register of Registrable Controllers',
    'Register of Directors',
    'Register of Members',
    'Register of Secretaries',
    'Register of Auditors',
    'Register of CEOs.',
  ],
  scopeLimit: 'Our scope of services does not include attending to in-house administrative matters such as liaising with your bankers and filling up bank forms.',
  exclusionsTitle: 'Excluded services',
  exclusionsIntroduction: 'From time to time, you may require our services on special advisory secretarial matters and other ad hoc assignments. All work not covered under the ongoing services will be excluded and regarded as specific secretarial work.',
  exclusions: [
    'Preparing the financial statements in XBRL format;',
    'Uploading the XBRL financial statements to BizFinx;',
    'Purchase of ACRA business profiles;',
    'Applying to ACRA for extension of time for annual returns;',
    'Registration of CorpPass;',
    'Preparing letters or liaising with your external auditors;',
    'Providing advisory services on corporate secretarial matters;',
    'Arranging for certification of documents by notaries and embassies in Singapore;',
    'Attending to reporting of information and submitting documents and forms with other government agencies;',
    'Special assignments in advising on requirements for extraordinary general meetings;',
    'Assistance with directors’ and shareholders’ meetings such as preparing notices of meetings, organizing agenda papers and recording minutes of meetings; and',
    'Any other matters not included in the ongoing services.',
  ],
  closing: 'Our fee for specific secretarial work is based on the time required and we will provide an estimate of our time cost before commencing any such work.',
} as const;

export const REFERENCE_FINANCIAL_STATEMENTS_TAX_SOW = {
  title: 'Statement of Work – Unaudited Financial Statement Compilation and Corporate Tax Computation & Filing',
  paragraphs: [
    'Provision of Unaudited Financial Statement Compilation and Corporate Tax Computation and Filing services in accordance with the Singapore Financial Reporting Standard.',
    'The computation of the accounts will be based on the relevant records/documents, information, and explanation supplied to us. The control, accuracy, and completeness of the data are therefore the company’s management responsibility.',
  ],
  subsections: [
    {
      title: 'Unaudited Financial Statement Compilation',
      items: [
        'Prepare the directors’ statement for the purposes of annual filing with ACRA;',
        'Prepare the financial statements and accounting policies in accordance with Sections 201(2) and 201(5) of the Singapore Companies Act for the purposes of annual filing with ACRA.',
      ],
    },
    {
      title: 'Corporate Tax Computation & Filing – Yearly',
      items: [
        'Computation and filing of annual corporate tax and submission in IRAS MyTax Portal;',
        'Computation and filing of Estimated Chargeable Income (ECI) and submission in IRAS MyTax Portal;',
      ],
    },
  ],
} as const;

/** Slips in the reference agreement, corrected at the firm's request. */
export const REFERENCE_WORDING_CORRECTIONS: ReadonlyArray<{
  location: string;
  asWritten: string;
  corrected: string;
}> = [
  { location: 'Cover letter, third paragraph', asWritten: 'as set out in Appendix 2 signed between', corrected: 'as set out in Appendix 2) signed between' },
  { location: 'Terms 2.1', asWritten: 'third- party rights', corrected: 'third-party rights' },
  { location: 'Terms 12.1', asWritten: 'cause by circumstances beyond your or our reasonable control', corrected: 'caused by circumstances beyond your or our reasonable control.' },
  { location: 'Terms 13.1', asWritten: 'the laws of Singapore', corrected: 'the laws of Singapore.' },
  { location: 'Terms 13.2', asWritten: 'Singapore Mediation Centre, If the controversy', corrected: 'Singapore Mediation Centre. If the controversy' },
  { location: 'Appendix 2 introduction', asWritten: 'supplied to the us', corrected: 'supplied to us' },
  { location: 'Corporate Secretarial scope, closing', asWritten: 'based on the time required and will provide', corrected: 'based on the time required and we will provide' },
  { location: 'Statement of Work signatures', asWritten: 'Sign for and on behalf of Client', corrected: 'Signed for and on behalf of Client' },
];
