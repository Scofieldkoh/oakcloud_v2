'use client';

import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import {
  ExternalLink,
} from 'lucide-react';

// ============================================================================
// Setup Guide Modal Component
// ============================================================================

interface SetupGuideModalProps {
  provider: 'SHAREPOINT' | 'ONEDRIVE';
  onClose: () => void;
}

export function SetupGuideModal({ provider, onClose }: SetupGuideModalProps) {
  const isSharePoint = provider === 'SHAREPOINT';
  const title = isSharePoint ? 'SharePoint Setup Guide' : 'OneDrive Setup Guide';

  return (
    <Modal isOpen onClose={onClose} title={title} size="lg">
      <ModalBody>
        <div className="space-y-6 text-sm">
          {/* Step 1: Register Azure AD Application */}
          <section>
            <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-oak-light text-white flex items-center justify-center text-xs">1</span>
              Register Azure AD Application
            </h3>
            <ol className="list-decimal list-inside space-y-1 text-text-secondary ml-8">
              <li>
                Go to{' '}
                <a
                  href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-oak-light hover:underline inline-flex items-center gap-1"
                >
                  Azure Portal -&gt; App registrations
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>Click <strong>New registration</strong></li>
              <li>Enter a name (e.g., &quot;Oakcloud {isSharePoint ? 'SharePoint' : 'OneDrive'} Connector&quot;)</li>
              <li>Select <strong>Accounts in this organizational directory only</strong></li>
              <li>Click <strong>Register</strong></li>
            </ol>
          </section>

          {/* Step 2: Get Application IDs */}
          <section>
            <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-oak-light text-white flex items-center justify-center text-xs">2</span>
              Get Application IDs
            </h3>
            <div className="ml-8 text-text-secondary">
              <p className="mb-2">From the app&apos;s <strong>Overview</strong> page, copy:</p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Application (client) ID</strong> -&gt; Client ID</li>
                <li><strong>Directory (tenant) ID</strong> -&gt; Microsoft Tenant ID</li>
              </ul>
            </div>
          </section>

          {/* Step 3: Create Client Secret */}
          <section>
            <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-oak-light text-white flex items-center justify-center text-xs">3</span>
              Create Client Secret
            </h3>
            <ol className="list-decimal list-inside space-y-1 text-text-secondary ml-8">
              <li>Go to <strong>Certificates & secrets</strong> -&gt; <strong>Client secrets</strong></li>
              <li>Click <strong>New client secret</strong></li>
              <li>Add description and select expiry (recommend 24 months)</li>
              <li>Copy the <strong>Value</strong> immediately (shown only once!) -&gt; Client Secret</li>
            </ol>
          </section>

          {/* Step 4: Configure API Permissions */}
          <section>
            <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-oak-light text-white flex items-center justify-center text-xs">4</span>
              Configure API Permissions
            </h3>
            <ol className="list-decimal list-inside space-y-1 text-text-secondary ml-8">
              <li>Go to <strong>API permissions</strong> -&gt; <strong>Add a permission</strong></li>
              <li>Select <strong>Microsoft Graph</strong> -&gt; <strong>Application permissions</strong></li>
              <li>
                Add these permissions:
                <ul className="list-disc list-inside ml-4 mt-1">
                  {isSharePoint ? (
                    <>
                      <li><code className="bg-bg-tertiary px-1 rounded">Sites.ReadWrite.All</code></li>
                      <li><code className="bg-bg-tertiary px-1 rounded">Files.ReadWrite.All</code></li>
                      <li>
                        <code className="bg-bg-tertiary px-1 rounded">Mail.Read</code>
                        {' '}<span className="text-xs text-text-muted">(required for Communication sync)</span>
                      </li>
                    </>
                  ) : (
                    <>
                      <li><code className="bg-bg-tertiary px-1 rounded">Files.ReadWrite.All</code></li>
                      <li>
                        <code className="bg-bg-tertiary px-1 rounded">Mail.Read</code>
                        {' '}<span className="text-xs text-text-muted">(required for Communication sync)</span>
                      </li>
                    </>
                  )}
                </ul>
              </li>
              <li>Click <strong>Grant admin consent</strong> for your organization</li>
            </ol>
          </section>

          {/* Step 5: Get Site ID (SharePoint only) */}
          {isSharePoint && (
            <section>
              <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-oak-light text-white flex items-center justify-center text-xs">5</span>
                Get SharePoint Site ID
              </h3>
              <div className="ml-8 text-text-secondary space-y-2">
                <p>Open this URL in your browser (replace placeholders):</p>
                <code className="block bg-bg-tertiary p-2 rounded text-xs overflow-x-auto">
                  https://graph.microsoft.com/v1.0/sites/&#123;hostname&#125;:/sites/&#123;site-name&#125;
                </code>
                <p className="text-xs text-text-muted">
                  Example: <code className="bg-bg-tertiary px-1 rounded">https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/TeamSite</code>
                </p>
                <p>
                  You can also use{' '}
                  <a
                    href="https://developer.microsoft.com/en-us/graph/graph-explorer"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-oak-light hover:underline inline-flex items-center gap-1"
                  >
                    Graph Explorer
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {' '}to find your site ID.
                </p>
                <p>Copy the <strong>id</strong> field from the response -&gt; SharePoint Site ID</p>
              </div>
            </section>
          )}

          {/* Testing Section */}
          <section className="bg-bg-tertiary rounded-lg p-4">
            <h3 className="font-semibold text-text-primary mb-2">Testing the Connection</h3>
            <p className="text-text-secondary text-xs">
              After entering your credentials, click the <strong>Test</strong> button to verify the connection.
              If it fails, check that:
            </p>
            <ul className="list-disc list-inside text-text-secondary text-xs mt-2 space-y-1">
              <li>Admin consent has been granted for the API permissions</li>
              <li>The client secret has not expired</li>
              {isSharePoint && <li>The Site ID is correct and accessible</li>}
              <li>For Communication sync, <code className="bg-bg-primary px-1 rounded">Mail.Read</code> (Application) is granted</li>
              <li>Your tenant allows application access</li>
            </ul>
          </section>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="primary"
          onClick={() => window.open('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', '_blank')}
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          Open Azure Portal
        </Button>
      </ModalFooter>
    </Modal>
  );
}
