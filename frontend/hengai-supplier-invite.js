/**
 * HengAI · 供应商 H5 邀请链接（统一生成，禁止无参裸链）
 */
(function (global) {
  'use strict';

  var H5_PATH = '/static/HengAI_Supplier_H5.html';
  var SS_KEY = 'hengai_last_supplier_invite';

  function resolveAppState() {
    try {
      if (global.parent && global.parent !== global && global.parent.AppState) {
        return global.parent.AppState;
      }
    } catch (_) {}
    return global.AppState || null;
  }

  function readSessionInvite() {
    try {
      var raw = global.sessionStorage.getItem(SS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return null;
      return {
        submissionToken: o.submissionToken || o.submission_token || null,
        inviteCode: o.inviteCode || o.invite_code || null,
      };
    } catch (_) {
      return null;
    }
  }

  function persistSessionInvite(cred) {
    if (!cred || (!cred.submissionToken && !cred.inviteCode)) return;
    try {
      global.sessionStorage.setItem(
        SS_KEY,
        JSON.stringify({
          submissionToken: cred.submissionToken || null,
          inviteCode: cred.inviteCode || null,
          at: new Date().toISOString(),
        })
      );
    } catch (_) {}
  }

  function resolveInviteCredentials() {
    var tok = global.__hengaiSubmissionToken || null;
    var code = global.__hengaiInviteCode || null;
    if (tok || code) {
      return { submissionToken: tok, inviteCode: code };
    }
    var ss = readSessionInvite();
    if (ss && (ss.submissionToken || ss.inviteCode)) {
      return ss;
    }
    var AS = resolveAppState();
    var nodes = (AS && AS.supplierNodes) || [];
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      if (!n) continue;
      code = n.inviteCode || n.invite_code || null;
      if (!code || !String(code).trim()) continue;
      tok = n.submissionToken || n.submission_token || null;
      return { submissionToken: tok, inviteCode: code };
    }
    return { submissionToken: null, inviteCode: null };
  }

  function rememberInviteFromNode(node) {
    if (!node) return;
    var tok = node.submissionToken || node.submission_token || null;
    var code = node.inviteCode || node.invite_code || null;
    if (!tok && !code) return;
    if (tok) global.__hengaiSubmissionToken = tok;
    if (code) global.__hengaiInviteCode = code;
    var nid = node.id != null ? String(node.id) : '';
    if (nid) {
      global.__hengaiInviteByNodeId = global.__hengaiInviteByNodeId || {};
      global.__hengaiInviteByNodeId[nid] = { submissionToken: tok, inviteCode: code };
    }
    persistSessionInvite({ submissionToken: tok, inviteCode: code });
  }

  function rememberInviteFromResponse(resp) {
    if (!resp) return;
    var tok = resp.submissionToken || resp.submission_token || null;
    var code = resp.inviteCode || resp.invite_code || null;
    var nid = resp.supplierNodeId || resp.supplier_node_id || null;
    if (tok) global.__hengaiSubmissionToken = tok;
    if (code) global.__hengaiInviteCode = code;
    if (nid) {
      global.__hengaiInviteByNodeId = global.__hengaiInviteByNodeId || {};
      global.__hengaiInviteByNodeId[String(nid)] = { submissionToken: tok, inviteCode: code };
    }
    persistSessionInvite({ submissionToken: tok, inviteCode: code });
  }

  function buildSupplierH5InviteUrl() {
    var cred = resolveInviteCredentials();
    var origin = global.location.origin;
    if (!origin || global.location.protocol === 'file:') {
      var base = global.location.href;
      var hashIdx = base.indexOf('#');
      if (hashIdx >= 0) base = base.substring(0, hashIdx);
      var qIdx = base.indexOf('?');
      if (qIdx >= 0) base = base.substring(0, qIdx);
      var slashIdx = base.lastIndexOf('/');
      if (slashIdx >= 0) base = base.substring(0, slashIdx + 1);
      var bare = base + 'HengAI_Supplier_H5.html';
      if (cred.submissionToken) {
        return {
          url: bare + '?submission_token=' + encodeURIComponent(cred.submissionToken),
          ready: true,
          isFile: true,
        };
      }
      if (cred.inviteCode) {
        return {
          url: bare + '?invite_id=' + encodeURIComponent(cred.inviteCode),
          ready: true,
          isFile: true,
        };
      }
      return { url: bare, ready: false, needsInvite: true, isFile: true };
    }

    var bareHttp = origin + H5_PATH;
    if (cred.submissionToken) {
      return {
        url: bareHttp + '?submission_token=' + encodeURIComponent(cred.submissionToken),
        ready: true,
        isFile: false,
      };
    }
    if (cred.inviteCode) {
      return {
        url: bareHttp + '?invite_id=' + encodeURIComponent(cred.inviteCode),
        ready: true,
        isFile: false,
      };
    }
    return { url: bareHttp, ready: false, needsInvite: true, isFile: false };
  }

  global.hengaiResolveInviteCredentials = resolveInviteCredentials;
  global.hengaiRememberInviteFromNode = rememberInviteFromNode;
  global.hengaiRememberInviteFromResponse = rememberInviteFromResponse;
  global.hengaiBuildSupplierH5InviteUrl = buildSupplierH5InviteUrl;
})(typeof window !== 'undefined' ? window : global);
