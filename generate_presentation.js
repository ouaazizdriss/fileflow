const PptxGenJS = require('pptxgenjs');

const prs = new PptxGenJS();
prs.defineLayout({ name: 'LAYOUT_DEFAULT', master: 'MASTER_SLIDE' });

// Color scheme
const colors = {
  primary: '2563eb',      // Blue
  secondary: '1e40af',    // Dark blue
  accent: '3b82f6',       // Light blue
  dark: '1f2937',         // Dark gray
  light: 'f3f4f6',        // Light gray
  white: 'ffffff',
  success: '10b981',      // Green
  warning: 'f59e0b',      // Amber
};

const fonts = {
  title: 'Segoe UI',
  body: 'Segoe UI',
};

// Slide options
const slideOpts = {
  w: 10,
  h: 7.5,
  margin: [0.5, 0.5, 0.5, 0.5],
};

function addMasterSlide() {
  const master = prs.defineLayout(slideOpts);
  master.background = { color: colors.white };
  return master;
}

function addSlide(title, options = {}) {
  const slide = prs.addSlide();
  slide.background = { color: colors.white };

  if (title) {
    slide.addText(title, {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.6,
      fontSize: 44,
      bold: true,
      color: colors.primary,
      fontFace: fonts.title,
    });

    // Title underline
    slide.addShape(prs.ShapeType.rect, {
      x: 0.5,
      y: 1.0,
      w: 2,
      h: 0.05,
      fill: { color: colors.accent },
      line: { type: 'none' },
    });
  }

  return slide;
}

// ─────────────────────────────────────────────────────────
// SLIDE 1: Cover Slide
// ─────────────────────────────────────────────────────────
{
  const slide = prs.addSlide();
  slide.background = { color: colors.primary };

  slide.addText('FileFlow', {
    x: 0.5,
    y: 2.5,
    w: 9,
    h: 1,
    fontSize: 72,
    bold: true,
    color: colors.white,
    fontFace: fonts.title,
    align: 'center',
  });

  slide.addText('Professional File Management System', {
    x: 0.5,
    y: 3.8,
    w: 9,
    h: 0.5,
    fontSize: 28,
    color: colors.light,
    fontFace: fonts.body,
    align: 'center',
  });

  slide.addText('Complete Feature Overview', {
    x: 0.5,
    y: 5.5,
    w: 9,
    h: 0.4,
    fontSize: 18,
    color: colors.light,
    fontFace: fonts.body,
    align: 'center',
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 2: Platform Overview
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('Platform Overview');

  const features = [
    { icon: '📁', title: 'File Management', desc: 'Organize, upload, and manage files efficiently' },
    { icon: '👥', title: 'User Management', desc: 'Complete user and group administration' },
    { icon: '🔒', title: 'Security', desc: 'Role-based access control and permissions' },
    { icon: '📊', title: 'Audit Logging', desc: 'Complete audit trail for compliance' },
  ];

  let y = 1.3;
  features.forEach((feature) => {
    // Icon box
    slide.addShape(prs.ShapeType.rect, {
      x: 0.6,
      y: y - 0.15,
      w: 0.5,
      h: 0.5,
      fill: { color: colors.accent },
      line: { type: 'none' },
    });

    slide.addText(feature.icon, {
      x: 0.6,
      y: y - 0.15,
      w: 0.5,
      h: 0.5,
      fontSize: 24,
      align: 'center',
      valign: 'middle',
    });

    // Title
    slide.addText(feature.title, {
      x: 1.3,
      y: y,
      w: 8,
      h: 0.3,
      fontSize: 18,
      bold: true,
      color: colors.dark,
      fontFace: fonts.title,
    });

    // Description
    slide.addText(feature.desc, {
      x: 1.3,
      y: y + 0.35,
      w: 8,
      h: 0.3,
      fontSize: 14,
      color: '#666666',
      fontFace: fonts.body,
    });

    y += 1.35;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 3: Core Features - File Management
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('Core Features: File Management');

  const features = [
    '📤 Upload Files - Drag-and-drop or click-to-upload functionality',
    '📥 Download Files - Quick download with preserved file properties',
    '📂 Folder Operations - Create, rename, and delete directories',
    '🗂️ File Organization - Move and organize files with intuitive UI',
    '🔍 Search & Navigation - Sidebar tree view with nested folder support',
    '👁️ File Preview - Built-in preview for images and text files',
  ];

  let y = 1.4;
  features.forEach((feature) => {
    slide.addText(feature, {
      x: 1,
      y: y,
      w: 8.5,
      h: 0.35,
      fontSize: 14,
      color: colors.dark,
      fontFace: fonts.body,
      bullet: true,
    });
    y += 0.55;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 4: User Interface Features
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('User Interface Features');

  const features = [
    { title: 'Dual View Modes', desc: 'List view with detailed info & grid view for visual browsing' },
    { title: 'Context Menu', desc: 'Right-click menu for quick file operations' },
    { title: 'Dynamic Preview Panel', desc: 'Real-time preview of selected files' },
    { title: 'Status Bar', desc: 'File count, selection info, and system status display' },
    { title: 'Responsive Design', desc: 'Works seamlessly on desktop and responsive layouts' },
    { title: 'Customizable Theme', desc: 'Dark/light mode with tailwind CSS styling' },
  ];

  let y = 1.4;
  features.forEach((feature, idx) => {
    // Number badge
    slide.addShape(prs.ShapeType.ellipse, {
      x: 0.7,
      y: y - 0.1,
      w: 0.35,
      h: 0.35,
      fill: { color: colors.accent },
      line: { type: 'none' },
    });

    slide.addText(`${idx + 1}`, {
      x: 0.7,
      y: y - 0.1,
      w: 0.35,
      h: 0.35,
      fontSize: 12,
      bold: true,
      color: colors.white,
      align: 'center',
      valign: 'middle',
    });

    // Title
    slide.addText(feature.title, {
      x: 1.3,
      y: y,
      w: 8,
      h: 0.25,
      fontSize: 13,
      bold: true,
      color: colors.dark,
    });

    // Description
    slide.addText(feature.desc, {
      x: 1.3,
      y: y + 0.3,
      w: 8,
      h: 0.25,
      fontSize: 11,
      color: '#666666',
    });

    y += 0.75;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 5: User Management & Administration
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('User Management & Administration');

  slide.addText('Admin Features', {
    x: 0.5,
    y: 1.2,
    w: 4.5,
    h: 0.3,
    fontSize: 16,
    bold: true,
    color: colors.primary,
  });

  const adminFeatures = [
    '👤 Create & Delete Users',
    '🔑 Password Management',
    '👥 Group Management',
    '📝 Bulk User Operations',
    '🔐 Role Assignment',
  ];

  let y = 1.6;
  adminFeatures.forEach((feature) => {
    slide.addText(feature, {
      x: 0.8,
      y: y,
      w: 4,
      h: 0.3,
      fontSize: 12,
      color: colors.dark,
      bullet: true,
    });
    y += 0.45;
  });

  // Right column
  slide.addText('User Roles', {
    x: 5.2,
    y: 1.2,
    w: 4.5,
    h: 0.3,
    fontSize: 16,
    bold: true,
    color: colors.primary,
  });

  const roles = [
    { role: 'Admin', desc: 'Full system access' },
    { role: 'User', desc: 'Standard file operations' },
    { role: 'Group Manager', desc: 'Manage group members' },
  ];

  y = 1.6;
  roles.forEach((r) => {
    slide.addShape(prs.ShapeType.rect, {
      x: 5.2,
      y: y,
      w: 4.3,
      h: 0.4,
      fill: { color: colors.light },
      line: { color: colors.accent, width: 1 },
    });

    slide.addText(r.role, {
      x: 5.4,
      y: y + 0.05,
      w: 2,
      h: 0.3,
      fontSize: 12,
      bold: true,
      color: colors.primary,
    });

    slide.addText(r.desc, {
      x: 5.4,
      y: y + 0.05,
      w: 4,
      h: 0.3,
      fontSize: 10,
      color: '#666666',
      align: 'right',
    });

    y += 0.6;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 6: Security & Access Control
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('Security & Access Control');

  const securityFeatures = [
    {
      title: 'Authentication',
      items: ['JWT-based session tokens', 'Secure password hashing', 'HTTP-only cookies'],
    },
    {
      title: 'Authorization',
      items: ['Role-based access control (RBAC)', 'Permission validation', 'Group-based access'],
    },
    {
      title: 'Data Protection',
      items: ['Encrypted password storage', 'Secure file operations', 'Session management'],
    },
  ];

  let y = 1.4;
  securityFeatures.forEach((section) => {
    slide.addText(section.title, {
      x: 1,
      y: y,
      w: 8,
      h: 0.3,
      fontSize: 14,
      bold: true,
      color: colors.primary,
    });

    y += 0.4;
    section.items.forEach((item) => {
      slide.addText(item, {
        x: 1.5,
        y: y,
        w: 8,
        h: 0.25,
        fontSize: 11,
        color: colors.dark,
        bullet: true,
      });
      y += 0.35;
    });

    y += 0.2;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 7: Sharing & Collaboration
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('Sharing & Collaboration');

  const features = [
    {
      icon: '🔗',
      title: 'Shared Links',
      desc: 'Generate and manage shareable links for files and folders',
    },
    {
      icon: '📤',
      title: 'Upload Requests',
      desc: 'Request files from users via customizable upload dialogs',
    },
    {
      icon: '🤝',
      title: 'Collaboration',
      desc: 'Real-time collaboration features for team workflows',
    },
    {
      icon: '🔄',
      title: 'Share Management',
      desc: 'Control, track, and revoke shares with granular permissions',
    },
  ];

  let y = 1.3;
  features.forEach((feature) => {
    // Icon
    slide.addText(feature.icon, {
      x: 0.8,
      y: y,
      w: 0.4,
      h: 0.4,
      fontSize: 20,
      align: 'center',
      valign: 'middle',
    });

    // Title
    slide.addText(feature.title, {
      x: 1.4,
      y: y + 0.05,
      w: 8,
      h: 0.25,
      fontSize: 13,
      bold: true,
      color: colors.primary,
    });

    // Description
    slide.addText(feature.desc, {
      x: 1.4,
      y: y + 0.3,
      w: 8,
      h: 0.25,
      fontSize: 11,
      color: '#666666',
    });

    y += 0.75;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 8: Advanced Features
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('Advanced Features');

  const features = [
    {
      title: '🗑️ Trash & Recovery',
      desc: 'Recover deleted files with complete trash management',
    },
    {
      title: '📜 Version History',
      desc: 'Track file versions and restore previous versions',
    },
    {
      title: '🌐 Multi-language Support',
      desc: 'Internationalization support with i18n integration',
    },
    {
      title: '📋 Audit Logs',
      desc: 'Complete audit trail for compliance and security',
    },
    {
      title: '⚙️ System Configuration',
      desc: 'Flexible configuration for deployment and customization',
    },
    {
      title: '🔐 Password Management',
      desc: 'Users can change their own passwords securely',
    },
  ];

  let x = 0.6;
  let y = 1.4;
  let col = 0;

  features.forEach((feature, idx) => {
    if (col === 2) {
      col = 0;
      y += 1.5;
      x = 0.6;
    }

    slide.addText(feature.title, {
      x: x,
      y: y,
      w: 4.5,
      h: 0.3,
      fontSize: 12,
      bold: true,
      color: colors.dark,
    });

    slide.addText(feature.desc, {
      x: x,
      y: y + 0.35,
      w: 4.5,
      h: 0.5,
      fontSize: 10,
      color: '#666666',
    });

    x += 4.7;
    col++;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 9: Technical Stack
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('Technical Stack');

  const stacks = [
    {
      category: 'Frontend',
      icon: '⚛️',
      technologies: ['React.js', 'TypeScript', 'Tailwind CSS', 'React Router', 'i18n'],
    },
    {
      category: 'Backend',
      icon: '⚙️',
      technologies: ['Rust', 'Axum Framework', 'Tokio', 'JWT Auth', 'SQLite/JSON'],
    },
    {
      category: 'DevOps',
      icon: '🐳',
      technologies: ['Docker', 'Docker Compose', 'Vite Build Tool'],
    },
  ];

  let y = 1.4;
  stacks.forEach((stack) => {
    // Category header
    slide.addText(`${stack.icon} ${stack.category}`, {
      x: 0.8,
      y: y,
      w: 8.5,
      h: 0.3,
      fontSize: 14,
      bold: true,
      color: colors.primary,
    });

    y += 0.45;

    // Technologies
    const techText = stack.technologies.join(' • ');
    slide.addText(techText, {
      x: 1.5,
      y: y,
      w: 8,
      h: 0.4,
      fontSize: 11,
      color: colors.dark,
    });

    y += 0.85;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 10: API Overview
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('REST API Overview');

  const sections = [
    { title: 'Authentication', endpoints: ['POST /api/login', 'POST /api/logout', 'GET /api/me'] },
    { title: 'Files', endpoints: ['GET /api/files', 'POST /api/files/upload', 'DELETE /api/files'] },
    { title: 'Users & Admin', endpoints: ['GET /api/users', 'POST /api/admin/users', 'PUT /api/admin/users/:id'] },
    { title: 'Sharing', endpoints: ['GET /api/shares', 'POST /api/shares', 'DELETE /api/shares/:id'] },
  ];

  let y = 1.4;
  sections.forEach((section) => {
    slide.addText(section.title, {
      x: 0.8,
      y: y,
      w: 4,
      h: 0.25,
      fontSize: 12,
      bold: true,
      color: colors.primary,
    });

    let endpointY = y + 0.3;
    section.endpoints.forEach((ep) => {
      slide.addText(ep, {
        x: 1.2,
        y: endpointY,
        w: 3.8,
        h: 0.22,
        fontSize: 9,
        color: colors.dark,
        fontFace: 'Courier New',
      });
      endpointY += 0.25;
    });

    y += 1.35;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 11: Deployment & Installation
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('Deployment & Installation');

  slide.addText('Quick Start Options', {
    x: 0.8,
    y: 1.2,
    w: 8.5,
    h: 0.3,
    fontSize: 16,
    bold: true,
    color: colors.primary,
  });

  const options = [
    {
      num: '1',
      title: 'Docker Compose',
      desc: 'Complete stack in one command with docker-compose',
    },
    {
      num: '2',
      title: 'Local Development',
      desc: 'Frontend and backend with hot-reload for development',
    },
    {
      num: '3',
      title: 'Cloud Deployment',
      desc: 'Containerized for Kubernetes and cloud platforms',
    },
  ];

  let y = 1.7;
  options.forEach((opt) => {
    // Number circle
    slide.addShape(prs.ShapeType.ellipse, {
      x: 0.8,
      y: y - 0.15,
      w: 0.4,
      h: 0.4,
      fill: { color: colors.primary },
      line: { type: 'none' },
    });

    slide.addText(opt.num, {
      x: 0.8,
      y: y - 0.15,
      w: 0.4,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: colors.white,
      align: 'center',
      valign: 'middle',
    });

    slide.addText(opt.title, {
      x: 1.5,
      y: y,
      w: 7.8,
      h: 0.25,
      fontSize: 13,
      bold: true,
      color: colors.dark,
    });

    slide.addText(opt.desc, {
      x: 1.5,
      y: y + 0.3,
      w: 7.8,
      h: 0.25,
      fontSize: 11,
      color: '#666666',
    });

    y += 1.15;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 12: Key Benefits
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('Key Benefits');

  const benefits = [
    { icon: '⚡', title: 'Performance', desc: 'Fast Rust backend, optimized React frontend' },
    { icon: '🔒', title: 'Security', desc: 'Enterprise-grade security with RBAC & audit logs' },
    { icon: '📈', title: 'Scalability', desc: 'Containerized architecture for easy scaling' },
    { icon: '🌐', title: 'Accessibility', desc: 'Multi-language support & responsive design' },
    { icon: '🛠️', title: 'Customizable', desc: 'Open-source, fully customizable codebase' },
    { icon: '📚', title: 'Compliance', desc: 'Complete audit trail for regulations' },
  ];

  let x = 0.6;
  let y = 1.4;
  let col = 0;

  benefits.forEach((benefit, idx) => {
    if (col === 2) {
      col = 0;
      y += 1.8;
      x = 0.6;
    }

    // Icon box
    slide.addShape(prs.ShapeType.rect, {
      x: x,
      y: y,
      w: 4.3,
      h: 1.3,
      fill: { color: colors.light },
      line: { color: colors.accent, width: 2 },
    });

    slide.addText(benefit.icon, {
      x: x + 0.15,
      y: y + 0.15,
      w: 0.5,
      h: 0.4,
      fontSize: 24,
    });

    slide.addText(benefit.title, {
      x: x + 0.8,
      y: y + 0.15,
      w: 3.3,
      h: 0.35,
      fontSize: 13,
      bold: true,
      color: colors.primary,
    });

    slide.addText(benefit.desc, {
      x: x + 0.15,
      y: y + 0.6,
      w: 4,
      h: 0.55,
      fontSize: 10,
      color: '#666666',
    });

    x += 4.5;
    col++;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 13: Use Cases
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('Ideal Use Cases');

  const usecases = [
    '🏢 Enterprise File Management',
    '🎓 Educational Institution Document Systems',
    '🏥 Healthcare Records Management',
    '⚖️ Legal Document Management with Audit Trail',
    '📊 Business Data Repositories',
    '🤝 Team Collaboration Platforms',
    '💼 Project Document Storage',
    '🔐 Secure File Sharing Service',
  ];

  let y = 1.4;
  let col = 0;
  let x = 0.6;

  usecases.forEach((usecase, idx) => {
    if (col === 2) {
      col = 0;
      y += 0.6;
      x = 0.6;
    }

    slide.addText(usecase, {
      x: x,
      y: y,
      w: 4.5,
      h: 0.4,
      fontSize: 12,
      color: colors.dark,
      bold: false,
    });

    x += 4.7;
    col++;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 14: Roadmap & Future
// ─────────────────────────────────────────────────────────
{
  const slide = addSlide('Future Enhancements');

  const features = [
    { phase: 'Short Term', items: ['Advanced search filters', 'File tagging system', 'Batch operations'] },
    { phase: 'Medium Term', items: ['Mobile app', 'Full-text search', 'Real-time sync'] },
    { phase: 'Long Term', items: ['Rule-based organization', 'Advanced integrations', 'Enterprise features'] },
  ];

  let y = 1.4;
  features.forEach((feature) => {
    // Phase header
    slide.addShape(prs.ShapeType.rect, {
      x: 0.8,
      y: y,
      w: 8.5,
      h: 0.3,
      fill: { color: colors.primary },
      line: { type: 'none' },
    });

    slide.addText(feature.phase, {
      x: 1,
      y: y,
      w: 8.1,
      h: 0.3,
      fontSize: 12,
      bold: true,
      color: colors.white,
      valign: 'middle',
    });

    y += 0.45;

    // Items
    feature.items.forEach((item) => {
      slide.addText(item, {
        x: 1.3,
        y: y,
        w: 8,
        h: 0.25,
        fontSize: 11,
        color: colors.dark,
        bullet: true,
      });
      y += 0.3;
    });

    y += 0.4;
  });
}

// ─────────────────────────────────────────────────────────
// SLIDE 15: Contact & Resources
// ─────────────────────────────────────────────────────────
{
  const slide = prs.addSlide();
  slide.background = { color: colors.primary };

  slide.addText('Thank You', {
    x: 0.5,
    y: 2,
    w: 9,
    h: 0.8,
    fontSize: 60,
    bold: true,
    color: colors.white,
    fontFace: fonts.title,
    align: 'center',
  });

  slide.addText('FileFlow - Professional File Management', {
    x: 0.5,
    y: 3.1,
    w: 9,
    h: 0.4,
    fontSize: 20,
    color: colors.light,
    fontFace: fonts.body,
    align: 'center',
  });

  slide.addText('For more information, visit the project repository or documentation', {
    x: 0.5,
    y: 4.2,
    w: 9,
    h: 0.5,
    fontSize: 14,
    color: colors.light,
    fontFace: fonts.body,
    align: 'center',
  });

  // Features summary at bottom
  const summaryFeatures = [
    '✓ Secure file management',
    '✓ Enterprise-grade security',
    '✓ Team collaboration',
    '✓ Audit compliance',
  ];

  let y = 5.3;
  summaryFeatures.forEach((feature) => {
    slide.addText(feature, {
      x: 0.5,
      y: y,
      w: 9,
      h: 0.25,
      fontSize: 12,
      color: colors.light,
      align: 'center',
    });
    y += 0.3;
  });
}

// Save the presentation
prs.writeFile({ fileName: 'FileFlow_Presentation.pptx' });

console.log('✅ PowerPoint presentation generated: FileFlow_Presentation.pptx');
