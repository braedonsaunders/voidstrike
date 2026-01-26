import { describe, it, expect, beforeEach } from 'vitest';
import { Selectable } from '@/engine/components/Selectable';

describe('Selectable Component', () => {
  let selectable: Selectable;

  beforeEach(() => {
    selectable = new Selectable(2, 10, 'player1', 1.5, 5);
  });

  describe('constructor', () => {
    it('sets selection radius', () => {
      expect(selectable.selectionRadius).toBe(2);
    });

    it('sets selection priority', () => {
      expect(selectable.selectionPriority).toBe(10);
    });

    it('sets player ID', () => {
      expect(selectable.playerId).toBe('player1');
    });

    it('sets visual scale', () => {
      expect(selectable.visualScale).toBe(1.5);
    });

    it('sets visual height', () => {
      expect(selectable.visualHeight).toBe(5);
    });

    it('initializes as not selected', () => {
      expect(selectable.isSelected).toBe(false);
    });

    it('initializes control group as null', () => {
      expect(selectable.controlGroup).toBe(null);
    });

    it('uses default values', () => {
      const s = new Selectable();

      expect(s.selectionRadius).toBe(1);
      expect(s.selectionPriority).toBe(0);
      expect(s.playerId).toBe('player1');
      expect(s.visualScale).toBe(1);
      expect(s.visualHeight).toBe(0);
    });
  });

  describe('select', () => {
    it('sets isSelected to true', () => {
      selectable.select();

      expect(selectable.isSelected).toBe(true);
    });

    it('can select multiple times without error', () => {
      selectable.select();
      selectable.select();

      expect(selectable.isSelected).toBe(true);
    });
  });

  describe('deselect', () => {
    it('sets isSelected to false', () => {
      selectable.select();
      selectable.deselect();

      expect(selectable.isSelected).toBe(false);
    });

    it('can deselect when already deselected', () => {
      selectable.deselect();

      expect(selectable.isSelected).toBe(false);
    });
  });

  describe('setControlGroup', () => {
    it('sets control group to a number', () => {
      selectable.setControlGroup(5);

      expect(selectable.controlGroup).toBe(5);
    });

    it('sets control group to zero', () => {
      selectable.setControlGroup(0);

      expect(selectable.controlGroup).toBe(0);
    });

    it('clears control group when set to null', () => {
      selectable.setControlGroup(3);
      selectable.setControlGroup(null);

      expect(selectable.controlGroup).toBe(null);
    });
  });

  describe('type property', () => {
    it('has correct component type', () => {
      expect(selectable.type).toBe('Selectable');
    });
  });
});
