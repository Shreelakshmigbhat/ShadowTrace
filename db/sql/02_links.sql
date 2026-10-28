-- 02_links.sql (Member B): many-to-many link tables (need evidence, investigations, assets to exist first)
USE shadowtrace;

CREATE TABLE evidence_investigations (
  evidence_id      INT NOT NULL,
  investigation_id INT NOT NULL,
  PRIMARY KEY (evidence_id, investigation_id),    -- composite PK: same pair cannot repeat
  CONSTRAINT fk_ei_evidence FOREIGN KEY (evidence_id)      REFERENCES evidence(id),
  CONSTRAINT fk_ei_inv      FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE,
  INDEX idx_ei_inv (investigation_id)
) ENGINE=InnoDB;

CREATE TABLE investigation_assets (
  investigation_id INT NOT NULL,
  asset_id         INT NOT NULL,
  PRIMARY KEY (investigation_id, asset_id),
  CONSTRAINT fk_ia_inv   FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ia_asset FOREIGN KEY (asset_id)         REFERENCES assets(id),
  INDEX idx_ia_asset (asset_id)
) ENGINE=InnoDB;
