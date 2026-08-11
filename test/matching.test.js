/**
 * Tests de l'appariement PowerPanne ↔ DepanTime.
 *
 * Les cas viennent du fichier réel : noms d'onglets PowerPanne d'un côté,
 * fiches salariés DepanTime de l'autre, avec les inversions, les fautes de
 * frappe et les homonymes qui s'y trouvent vraiment.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchDepanneur, apparier, editDistance, nameTokens, normNom } from '../src/core/matching.js'

/** Fiches DepanTime, telles que la table `employees` les stocke. */
const EMP = [
  { id: 1, nom: 'ROUX', prenom: 'Dylan' },
  { id: 2, nom: 'THUAL', prenom: 'Ronan' },
  { id: 3, nom: 'COMELLI', prenom: 'Romain' },
  { id: 4, nom: 'FACON', prenom: 'Laura' },
  { id: 5, nom: 'FACON', prenom: 'Thomas' },
  { id: 6, nom: 'BOUHAJRA', prenom: 'Safir' },
  { id: 7, nom: 'BOUHAJRA', prenom: 'Ilies' },
  { id: 8, nom: 'AKNIN', prenom: 'Soufyan' },
  { id: 9, nom: 'ATTUEL DELMAS', prenom: 'Damien' },
]

test('le nom d’onglet PowerPanne trouve la fiche, trigramme compris', () => {
  assert.equal(matchDepanneur('Dylan Roux (droux)', EMP).employeeId, 1)
  assert.equal(matchDepanneur('Soufyan Aknin (saknin)', EMP).employeeId, 8)
})

test('la casse et les accents sont indifférents', () => {
  assert.equal(matchDepanneur('ronan thual', EMP).employeeId, 2)
  assert.equal(matchDepanneur('RONAN THUAL', EMP).employeeId, 2)
})

test('l’ordre prénom / nom est indifférent', () => {
  assert.equal(matchDepanneur('Roux Dylan', EMP).employeeId, 1)
})

test('une faute de frappe d’une lettre est absorbée', () => {
  // Fautes constatées : THUAL/THURAL, COMELLI/COMELI.
  assert.equal(matchDepanneur('Ronan Thural', EMP).employeeId, 2)
  assert.equal(matchDepanneur('Romain Comeli', EMP).employeeId, 3)
})

test('un nom composé est reconnu', () => {
  assert.equal(matchDepanneur('Damien ATTUEL DELMAS (dattuel)', EMP).employeeId, 9)
})

test('deux homonymes se départagent par le prénom', () => {
  assert.equal(matchDepanneur('Laura Facon', EMP).employeeId, 4)
  assert.equal(matchDepanneur('Thomas Facon', EMP).employeeId, 5)
})

test('un nom de famille seul reste ambigu quand deux fiches le portent', () => {
  const r = matchDepanneur('Facon', EMP)
  assert.equal(r.employeeId, null)
  assert.equal(r.auto, false)
  assert.equal(r.candidates.length, 2)
})

test('une initiale reconnaît le prénom correspondant', () => {
  assert.equal(matchDepanneur('FACON L', EMP).employeeId, 4)
  assert.equal(matchDepanneur('FACON T', EMP).employeeId, 5)
})

test('un inconnu n’est pas rapproché au hasard', () => {
  const r = matchDepanneur('Service Dépannage', EMP)
  assert.equal(r.employeeId, null)
  assert.equal(r.auto, false)
})

test('un alias enregistré prime sur le rapprochement automatique', () => {
  const r = matchDepanneur('Service Dépannage', EMP, { 'service depannage': 8 })
  assert.equal(r.employeeId, 8)
  assert.equal(r.fromAlias, true)
})

test('deux noms qui désignent la même fiche repassent tous deux en manuel', () => {
  // Sans cette règle, les jours travaillés d'une personne seraient attribués
  // à deux dépanneurs — silencieusement.
  const emp = [{ id: 7, nom: 'BOUHAJRA', prenom: 'Ilies' }]
  const r = apparier(['Safir Bouhajra', 'ilies bouhajra'], emp)
  assert.equal(Object.keys(r.resolus).length, 0)
  assert.equal(r.manuels.length, 2)
  assert.ok(r.manuels.every((m) => m.raison === 'collision'))
  assert.ok(r.manuels[0].candidates.length >= 1)
})

test('les deux Bouhajra sont distingués quand les deux fiches existent', () => {
  const r = apparier(['Safir Bouhajra', 'ilies bouhajra'], EMP)
  assert.equal(r.resolus['Safir Bouhajra'].employeeId, 6)
  assert.equal(r.resolus['ilies bouhajra'].employeeId, 7)
  assert.equal(r.manuels.length, 0)
})

test('apparier signale les fiches sans intervention', () => {
  const r = apparier(['Dylan Roux'], EMP)
  assert.equal(Object.keys(r.resolus).length, 1)
  assert.equal(r.inutilises.length, EMP.length - 1)
})

test('un alias survit à la détection de collision', () => {
  const emp = [{ id: 7, nom: 'BOUHAJRA', prenom: 'Ilies' }]
  const r = apparier(['Safir Bouhajra', 'ilies bouhajra'], emp, { 'safir bouhajra': 7 })
  // L'alias est un choix explicite : il tient. L'autre nom reste à trancher.
  assert.equal(r.resolus['Safir Bouhajra'].employeeId, 7)
  assert.equal(r.manuels.length, 1)
  assert.equal(r.manuels[0].depanneur, 'ilies bouhajra')
})

test('outils de normalisation', () => {
  assert.equal(normNom('Cédric HERNANDEZ'), 'cedric hernandez')
  assert.deepEqual(nameTokens('Dylan Roux (droux)'), ['dylan', 'roux'])
  assert.deepEqual(nameTokens('Anis El Mabouacif'), ['anis', 'mabouacif'])
  assert.equal(editDistance('thual', 'thural'), 1)
  assert.equal(editDistance('comelli', 'comeli'), 1)
  assert.equal(editDistance('roux', 'roux'), 0)
})
