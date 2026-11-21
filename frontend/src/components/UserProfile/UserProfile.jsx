import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Card from '../Card/Card';
import Button from '../Button/Button';
import Input from '../Input/Input';
import Alert from '../Alert/Alert';
import Skeleton from '../Skeleton/Skeleton';
import Spinner from '../Spinner/Spinner';
import { useWalletStore } from '../../store/useWalletStore';
import { useToastStore } from '../../store/useToastStore';
import styles from './UserProfile.module.css';

export default function UserProfile() {
  const { t } = useTranslation();
  const { publicKey } = useWalletStore();
  const addToast = useToastStore((state) => state.addToast);

  // Profile information state
  const [profileData, setProfileData] = useState({
    displayName: '',
    email: '',
    bio: '',
    website: '',
    location: '',
    avatar: null,
    avatarUrl: '',
  });

  // Settings state
  const [preferences, setPreferences] = useState({
    darkMode: localStorage.getItem('theme') === 'dark',
    emailNotifications: localStorage.getItem('emailNotifications') !== 'false',
    priceAlerts: localStorage.getItem('priceAlerts') !== 'false',
    transactionNotifications: localStorage.getItem('transactionNotifications') !== 'false',
    marketingEmails: localStorage.getItem('marketingEmails') === 'true',
    language: localStorage.getItem('language') || 'en',
    twoFactorEnabled: localStorage.getItem('twoFactorEnabled') === 'true',
    autoLogout: localStorage.getItem('autoLogout') !== 'false',
  });

  const [activeTab, setActiveTab] = useState('profile'); // 'profile', 'settings', 'security'
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState('');

  // Load profile data on mount
  useEffect(() => {
    loadProfileData();
  }, [publicKey]);

  const loadProfileData = () => {
    setLoading(true);
    try {
      const stored = localStorage.getItem(`userProfile_${publicKey}`);
      if (stored) {
        setProfileData(JSON.parse(stored));
      } else {
        // Set default display name from wallet address
        setProfileData((prev) => ({
          ...prev,
          displayName: `User_${publicKey?.slice(0, 6)}`,
        }));
      }
    } catch (err) {
      console.error('Error loading profile:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleProfileChange = (field, value) => {
    setProfileData((prev) => ({
      ...prev,
      [field]: value,
    }));
    if (errors[field]) {
      setErrors((prev) => ({
        ...prev,
        [field]: '',
      }));
    }
  };

  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrors((prev) => ({
        ...prev,
        avatar: 'Please select an image file',
      }));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      // 5MB limit
      setErrors((prev) => ({
        ...prev,
        avatar: 'Image must be smaller than 5MB',
      }));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      handleProfileChange('avatarUrl', event.target.result);
      setErrors((prev) => ({
        ...prev,
        avatar: '',
      }));
    };
    reader.readAsDataURL(file);
  };

  const validateProfile = () => {
    const newErrors = {};

    if (!profileData.displayName.trim()) {
      newErrors.displayName = 'Display name is required';
    }

    if (profileData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileData.email)) {
      newErrors.email = 'Invalid email address';
    }

    if (profileData.website && !/^https?:\/\/.+/.test(profileData.website)) {
      newErrors.website = 'Website must start with http:// or https://';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveProfile = async () => {
    if (!validateProfile()) return;

    setIsSaving(true);
    try {
      localStorage.setItem(`userProfile_${publicKey}`, JSON.stringify(profileData));
      setSuccessMessage('Profile updated successfully!');
      addToast({ type: 'success', message: 'Profile saved!' });
      setIsEditing(false);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error saving profile:', err);
      addToast({ type: 'error', message: 'Failed to save profile' });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreferenceChange = (field, value) => {
    setPreferences((prev) => ({
      ...prev,
      [field]: value,
    }));
    // Save to localStorage immediately
    localStorage.setItem(
      field === 'darkMode' ? 'theme' : field,
      field === 'darkMode' ? (value ? 'dark' : 'light') : value ? 'true' : 'false'
    );
    addToast({ type: 'success', message: `${field} updated` });
  };

  const handleExportData = () => {
    try {
      const data = {
        profile: profileData,
        preferences: preferences,
        exportDate: new Date().toISOString(),
        publicKey: publicKey,
      };

      const dataStr = JSON.stringify(data, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rwa-profile-${publicKey?.slice(0, 6)}-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);

      addToast({ type: 'success', message: 'Profile data exported successfully' });
    } catch (err) {
      console.error('Error exporting data:', err);
      addToast({ type: 'error', message: 'Failed to export data' });
    }
  };

  const handleDeleteAccount = () => {
    if (window.confirm('Are you sure you want to delete your profile? This action cannot be undone.')) {
      try {
        localStorage.removeItem(`userProfile_${publicKey}`);
        setProfileData({
          displayName: '',
          email: '',
          bio: '',
          website: '',
          location: '',
          avatar: null,
          avatarUrl: '',
        });
        addToast({ type: 'success', message: 'Profile deleted successfully' });
        setActiveTab('profile');
      } catch (err) {
        console.error('Error deleting profile:', err);
        addToast({ type: 'error', message: 'Failed to delete profile' });
      }
    }
  };

  if (!publicKey) {
    return (
      <Card className={styles.card}>
        <div className={styles.stateContainer}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          <p className={styles.stateText}>Connect your wallet to view your profile</p>
        </div>
      </Card>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>User Profile</h2>
          <p className={styles.subtitle}>Manage your account, preferences, and settings</p>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'profile' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          Profile
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'settings' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m5.08 5.08l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m5.08-5.08l4.24-4.24"></path>
          </svg>
          Settings
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'security' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('security')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          Security & Data
        </button>
      </div>

      {successMessage && (
        <Alert variant="success" style={{ marginBottom: 'var(--spacing-md)' }}>
          {successMessage}
        </Alert>
      )}

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className={styles.tabContent}>
          {loading ? (
            <Card>
              <div className={styles.loadingContainer}>
                <Spinner />
              </div>
            </Card>
          ) : (
            <>
              <Card className={styles.profileHeader}>
                <div className={styles.avatarSection}>
                  <div className={styles.avatarContainer}>
                    {profileData.avatarUrl ? (
                      <img src={profileData.avatarUrl} alt="Avatar" className={styles.avatar} />
                    ) : (
                      <div className={styles.avatarPlaceholder}>
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                          <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                      </div>
                    )}
                  </div>
                  {isEditing && (
                    <div className={styles.uploadContainer}>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        id="avatar-upload"
                        className={styles.fileInput}
                      />
                      <label htmlFor="avatar-upload" className={styles.uploadLabel}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="16 16 12 12 8 16"></polyline>
                          <line x1="12" y1="12" x2="12" y2="21"></line>
                          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path>
                        </svg>
                        Change Avatar
                      </label>
                      {errors.avatar && <span className={styles.error}>{errors.avatar}</span>}
                    </div>
                  )}
                </div>
                <div className={styles.profileInfo}>
                  <div>
                    <h3 className={styles.displayName}>{profileData.displayName || 'No name set'}</h3>
                    <p className={styles.publicKey} title={publicKey}>
                      {publicKey.slice(0, 16)}…
                    </p>
                  </div>
                  {!isEditing && (
                    <Button
                      onClick={() => setIsEditing(true)}
                      variant="primary"
                      size="sm"
                      className={styles.editButton}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                      Edit Profile
                    </Button>
                  )}
                </div>
              </Card>

              <Card className={styles.formCard}>
                <div className={styles.formSection}>
                  <h3 className={styles.sectionTitle}>Basic Information</h3>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Display Name</label>
                    <Input
                      type="text"
                      value={profileData.displayName}
                      onChange={(e) => handleProfileChange('displayName', e.target.value)}
                      disabled={!isEditing}
                      placeholder="Your display name"
                      className={errors.displayName ? styles.inputError : ''}
                    />
                    {errors.displayName && <span className={styles.error}>{errors.displayName}</span>}
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Email Address</label>
                    <Input
                      type="email"
                      value={profileData.email}
                      onChange={(e) => handleProfileChange('email', e.target.value)}
                      disabled={!isEditing}
                      placeholder="your@email.com"
                      className={errors.email ? styles.inputError : ''}
                    />
                    {errors.email && <span className={styles.error}>{errors.email}</span>}
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Location</label>
                    <Input
                      type="text"
                      value={profileData.location}
                      onChange={(e) => handleProfileChange('location', e.target.value)}
                      disabled={!isEditing}
                      placeholder="City, Country"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Website</label>
                    <Input
                      type="url"
                      value={profileData.website}
                      onChange={(e) => handleProfileChange('website', e.target.value)}
                      disabled={!isEditing}
                      placeholder="https://example.com"
                      className={errors.website ? styles.inputError : ''}
                    />
                    {errors.website && <span className={styles.error}>{errors.website}</span>}
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Bio</label>
                    <textarea
                      value={profileData.bio}
                      onChange={(e) => handleProfileChange('bio', e.target.value)}
                      disabled={!isEditing}
                      placeholder="Tell us about yourself"
                      className={styles.textarea}
                      rows={4}
                    />
                  </div>

                  {isEditing && (
                    <div className={styles.formActions}>
                      <Button
                        onClick={handleSaveProfile}
                        loading={isSaving}
                        variant="primary"
                      >
                        {isSaving ? 'Saving…' : 'Save Profile'}
                      </Button>
                      <Button
                        onClick={() => {
                          setIsEditing(false);
                          loadProfileData();
                        }}
                        variant="secondary"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className={styles.tabContent}>
          <Card className={styles.settingsCard}>
            <h3 className={styles.sectionTitle}>Notification Preferences</h3>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingLabel}>Email Notifications</h4>
                <p className={styles.settingDescription}>Receive important updates via email</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={preferences.emailNotifications}
                  onChange={(e) => handlePreferenceChange('emailNotifications', e.target.checked)}
                />
                <span className={styles.toggleSlider}></span>
              </label>
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingLabel}>Price Alerts</h4>
                <p className={styles.settingDescription}>Get notified when asset prices change</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={preferences.priceAlerts}
                  onChange={(e) => handlePreferenceChange('priceAlerts', e.target.checked)}
                />
                <span className={styles.toggleSlider}></span>
              </label>
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingLabel}>Transaction Notifications</h4>
                <p className={styles.settingDescription}>Be notified of your buy/sell transactions</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={preferences.transactionNotifications}
                  onChange={(e) => handlePreferenceChange('transactionNotifications', e.target.checked)}
                />
                <span className={styles.toggleSlider}></span>
              </label>
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingLabel}>Marketing Emails</h4>
                <p className={styles.settingDescription}>Receive promotional offers and updates</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={preferences.marketingEmails}
                  onChange={(e) => handlePreferenceChange('marketingEmails', e.target.checked)}
                />
                <span className={styles.toggleSlider}></span>
              </label>
            </div>
          </Card>

          <Card className={styles.settingsCard}>
            <h3 className={styles.sectionTitle}>Display Preferences</h3>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingLabel}>Dark Mode</h4>
                <p className={styles.settingDescription}>Use dark theme for the interface</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={preferences.darkMode}
                  onChange={(e) => {
                    handlePreferenceChange('darkMode', e.target.checked);
                    document.documentElement.setAttribute(
                      'data-theme',
                      e.target.checked ? 'dark' : 'light'
                    );
                  }}
                />
                <span className={styles.toggleSlider}></span>
              </label>
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <h4 className={styles.settingLabel}>Auto Logout</h4>
                <p className={styles.settingDescription}>Automatically log out after inactivity</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={preferences.autoLogout}
                  onChange={(e) => handlePreferenceChange('autoLogout', e.target.checked)}
                />
                <span className={styles.toggleSlider}></span>
              </label>
            </div>
          </Card>
        </div>
      )}

      {/* Security & Data Tab */}
      {activeTab === 'security' && (
        <div className={styles.tabContent}>
          <Card className={styles.securityCard}>
            <h3 className={styles.sectionTitle}>Security Settings</h3>

            <div className={styles.securityItem}>
              <div className={styles.securityInfo}>
                <h4 className={styles.securityLabel}>Two-Factor Authentication</h4>
                <p className={styles.securityDescription}>
                  {preferences.twoFactorEnabled
                    ? 'Two-factor authentication is enabled'
                    : 'Enhance your account security with 2FA'}
                </p>
              </div>
              <Button
                onClick={() => {
                  handlePreferenceChange('twoFactorEnabled', !preferences.twoFactorEnabled);
                }}
                variant={preferences.twoFactorEnabled ? 'secondary' : 'primary'}
                size="sm"
              >
                {preferences.twoFactorEnabled ? 'Disable 2FA' : 'Enable 2FA'}
              </Button>
            </div>
          </Card>

          <Card className={styles.dataCard}>
            <h3 className={styles.sectionTitle}>Data Management</h3>

            <div className={styles.dataAction}>
              <div className={styles.dataInfo}>
                <h4 className={styles.dataLabel}>Export Your Data</h4>
                <p className={styles.dataDescription}>
                  Download a copy of your profile, preferences, and settings in JSON format
                </p>
              </div>
              <Button
                onClick={handleExportData}
                variant="primary"
                size="sm"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Export Data
              </Button>
            </div>

            <div className={styles.divider}></div>

            <div className={styles.dangerZone}>
              <div className={styles.dangerInfo}>
                <h4 className={styles.dangerLabel}>Delete Profile</h4>
                <p className={styles.dangerDescription}>
                  Permanently delete your profile and all associated data. This action cannot be undone.
                </p>
              </div>
              <Button
                onClick={handleDeleteAccount}
                variant="danger"
                size="sm"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
                Delete Profile
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
