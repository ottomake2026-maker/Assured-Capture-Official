export type ReportStatus =
  | 'Draft'
  | 'In Progress'
  | 'Awaiting Review'
  | 'Completed'
  | 'Sent to Client';

export interface InspectionDateHistoryRecord {
  date: string;
  changedAt: string;
}

export interface Report {
  id: string;
  userId?: string;
  jobReference: string;
  reportName: string;
  reportType?: string;
  clientName: string;
  address: string;
  reportDate: string; // YYYY-MM-DD
  status: ReportStatus;
  inspectionDate: string; // YYYY-MM-DD
  inspectionDateHistory: InspectionDateHistoryRecord[];
  highestIssueNumberAssigned: number;
  reportImage?: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
}

export interface Issue {
  id: string;
  userId?: string;
  reportId: string;
  issueNumber: number;
  issueName: string;
  issueDescription: string;
  category?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TextBoxAnnotation {
  id: string;
  text: string;
  x: number; // percentage 0 - 100 relative to image width
  y: number; // percentage 0 - 100 relative to image height
  color: string; // hex color e.g. '#EF4444', '#FACC15', '#628EF7'
  fontSize?: number;
  scale?: number; // relative scaling multiplier (default 1.0, e.g. 0.5 to 3.5)
  width?: number;
  height?: number;
}

export interface Photo {
  id: string;
  userId?: string;
  issueId: string;
  reportId: string;
  imageFile: string; // data URL or Blob storage reference
  originalImageFile?: string; // Pristine unflattened original photo for non-destructive markup editing
  textBoxAnnotations?: TextBoxAnnotation[]; // Structured text box annotations
  storageUri: string; // gs://assured-capture-storage/reports/{jobReference}/issue_{issueNumber}/{photoId}.jpg
  description: string;
  isReferenceImage: boolean;
  issueNumber: number;
  jobReference: string;
  sequenceNumber?: number; // 1-based sequential evidence order within the issue
  capturedAt?: string | null; // Original capture timestamp from EXIF DateTimeOriginal (null if unavailable)
  internalNotes?: string; // Surveyor Field Notes (Internal Only) per evidence item
  includeInReport?: boolean; // Controls inclusion in exported Photo Report (default true)
  createdAt: string;
  updatedAt: string;
}

export interface UploadTask {
  id: string;
  fileName: string;
  fileSize: number;
  previewUrl: string;
  progress: number; // 0 to 100
  state: 'uploading' | 'complete' | 'failed';
  errorMessage?: string;
  photoId?: string;
}

export interface UserProfile {
  userId?: string | null;
  profileName?: string;
  displayName?: string;
  name: string;
  fullName?: string;
  avatarUrl: string;
  photoURL?: string | null;
  avatarStorageUri?: string;
  email?: string;
  role?: string;
  accountType?: 'authenticated' | 'guest';
  createdAt?: string;
  updatedAt?: string;
}

export type ActiveScreen = 'reports_home' | 'report_detail' | 'issues_list' | 'issue_detail' | 'photo_detail' | 'user_profile';
