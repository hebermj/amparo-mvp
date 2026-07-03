'use strict';

/**
 * Tools index — re-exports are imported individually by the orchestrator.
 * This module provides backwards-compatible flat access for testing.
 */
const SearchTool = require('./search');
const ProfileTool = require('./profile');
const ConsentTool = require('./consent');
const ConfirmTool = require('./confirm');
const CheckoutTool = require('./checkout');

module.exports = {
  SearchTool,
  ProfileTool,
  ConsentTool,
  ConfirmTool,
  CheckoutTool,
};
