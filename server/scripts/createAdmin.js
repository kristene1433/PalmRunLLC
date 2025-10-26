const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const ARG_PREFIX = '--';
const DEFAULTS = {
  email: process.env.ADMIN_EMAIL || 'admin@palmrunllc.com',
  password: process.env.ADMIN_PASSWORD || 'admin123',
  firstName: 'Admin',
  lastName: 'User'
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = { ...DEFAULTS, force: false };

  args.forEach(arg => {
    if (!arg.startsWith(ARG_PREFIX)) return;

    const [rawKey, ...rest] = arg.slice(ARG_PREFIX.length).split('=');
    const key = rawKey.trim();
    const value = rest.length ? rest.join('=').trim() : true;

    switch (key) {
      case 'email':
      case 'password':
      case 'firstName':
      case 'lastName':
        if (typeof value === 'string' && value.length) {
          options[key] = value;
        }
        break;
      case 'force':
        options.force = value === true || value === 'true';
        break;
      case 'help':
      case 'h':
        options.help = true;
        break;
      default:
        console.warn(`Unknown option: --${key}`);
    }
  });

  return options;
};

const showHelp = () => {
  console.log(`
Usage: node server/scripts/createAdmin.js [options]

Options:
  --email=<email>         Admin email (default: ${DEFAULTS.email})
  --password=<password>   Admin password, min 6 chars (default: ${DEFAULTS.password})
  --firstName=<name>      Admin first name (default: ${DEFAULTS.firstName})
  --lastName=<name>       Admin last name (default: ${DEFAULTS.lastName})
  --force                 Reset password if user already exists
  --help                  Show this help
`);
};

const createAdmin = async () => {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Please add it to your .env file.');
    process.exit(1);
  }

  if (!options.password || options.password.length < 6) {
    console.error('Password must be at least 6 characters long.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const existingAdmin = await User.findOne({ email: options.email });

    if (existingAdmin) {
      if (!options.force) {
        console.log(`An account with email ${options.email} already exists.`);
        console.log('Re-run with --force to reset the password (other fields will be updated).');
        process.exit(0);
      }

      console.log(`Resetting password for ${options.email}...`);
      existingAdmin.password = options.password; // hashed via pre-save hook
      existingAdmin.firstName = options.firstName;
      existingAdmin.lastName = options.lastName;
      existingAdmin.role = 'admin';
      existingAdmin.isActive = true;
      await existingAdmin.save();
      console.log('Admin password reset successfully!');
      process.exit(0);
    }

    const adminUser = new User({
      email: options.email,
      password: options.password,
      firstName: options.firstName,
      lastName: options.lastName,
      role: 'admin'
    });

    await adminUser.save();
    console.log(`Admin user ${options.email} created successfully!`);
    console.log('Please change the password after first login.');
  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    await mongoose.connection.close();
  }
};

createAdmin();
