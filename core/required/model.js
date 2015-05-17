"use strict";

module.exports = (function() {

  const DataTypes = require('./data_types.js');
  const Database = require('./db/database.js');

  class Model {

    constructor(modelData, fromStorage) {

      this._validations = {};

      this.preInitialize();
      this.initialize();
      modelData && this.load(modelData, fromStorage);
      this.postInitialize();

    }

    validates(field, message, fnAction) {

      this._validations[field] = this._validations[field] || [];
      this._validations[field].push({message: message, action: fnAction});

    }

    preInitialize() {
      return true;
    }

    postInitialize() {
      return true;
    }

    inStorage() {
      return this._inStorage;
    }

    initialize() {

      this._inStorage = false;

      this._table = this.schema.table;
      this._fieldArray = this.schema.columns.slice();

      let fieldLookup = {};

      this._fieldArray.forEach(function(v) {
        fieldLookup[v.name] = v;
      });

      this._fieldLookup = fieldLookup;

      let data = {};
      let changed = {};

      this.fieldList().forEach(function(v) {
        data[v] = null;
        changed[v] = false;
      });

      this._data = data;
      this._changed = changed;
      this._errors = {};

      this._validate();

      return true;

    }

    hasChanged(field) {
      return field === undefined ? this.changedFields().length > 0 : !!this._changed[field];
    }

    changedFields() {
      let changed = this._changed;
      return Object.keys(changed).filter(function(v) {
        return changed[v];
      });
    }

    errorObject() {
      return this.hasErrors() ? this.getErrors() : null;
    }

    hasErrors() {

      return Object.keys(this._errors).length > 0;

    }

    getErrors() {
      let obj = {};
      let errors = this._errors;
      Object.keys(errors).forEach(function(key) {
        obj[key] = errors[key];
      });
      return obj;
    }

    _validate(fieldList) {

      let data = this._data;

      this.clearError('*');

      return (fieldList || this.fieldList()).filter((function(field) {

        this.clearError(field);
        let value = data[field];

        return (this._validations[field] || []).filter((function(validation) {

          let isValid = validation.action.call(null, value);
          return !(isValid || !this.setError(field, validation.message));

        }).bind(this)).length > 0;

      }).bind(this)).concat((this._validations['*'] || []).filter((function(validation) {

        let isValid = validation.action.call(null, data);
        return !(isValid || !this.setError('*', validation.message));

      }).bind(this))).length > 0;

    }

    load(data, fromStorage) {

      let self = this;
      this._inStorage = !!fromStorage;

      !fromStorage && self.set('created_at', new Date());

      self.fieldList().filter(function(key) {
        return data.hasOwnProperty(key);
      }).forEach(function(key) {
        // do not validate or log changes when loading from storage
        self.set(key, data[key], !fromStorage, !fromStorage);
      });

      return this;

    }

    set(field, value, validate, logChange) {

      validate = (validate === undefined) ? true : !!validate;
      logChange = (logChange === undefined) ? true : !!logChange;

      if (!this.hasField(field)) {

        throw new Error('Field ' + field + ' does not belong to model ' + this.constructor.name);

      }

      let dataType = this.getDataTypeOf(field);
      let newValue = null;

      value = (value !== undefined) ? value : null;

      if (value !== null) {
        if (this.isFieldArray(field)) {
          newValue = value instanceof Array ? value : [value];
          newValue = newValue.map(function(v) { return dataType.convert(v); });
        } else {
          newValue = dataType.convert(value);
        }
      }

      let curValue = this._data[field];
      let changed = false;

      if (newValue !== curValue) {
        if (newValue instanceof Array && curValue instanceof Array) {
          if (newValue.filter(function(v, i) { return v !== curValue[i]; }).length) {
            this._data[field] = newValue;
            logChange && (changed = true);
          }
        } else {
          this._data[field] = newValue;
          logChange && (changed = true);
        }
      }

      this._changed[field] = changed;
      validate && (!logChange || changed) && this._validate([field]);

      return value;

    }

    get(key) {
      return this._data[key];
    }

    toObject() {
      let obj = {};
      let data = this._data;
      Object.keys(data).forEach(function(key) {
        obj[key] = data[key];
      });
      return obj;
    }

    toStdObject() {
      let obj = {};
      let data = this._data;
      this.externalInterface.forEach(function(key) {
        obj[key] = data[key];
      });
      return obj;
    }

    tableName() {
      return this._table;
    }

    hasField(field) {
      return !!this._fieldLookup[field];
    }

    getFieldData(field) {
      return this._fieldLookup[field];
    }

    getDataTypeOf(field) {
      return DataTypes[this._fieldLookup[field].type];
    }

    isFieldArray(field) {
      let fieldData = this._fieldLookup[field];
      return !!(fieldData && fieldData.properties && fieldData.properties.array);
    }

    isFieldPrimaryKey(field) {
      let fieldData = this._fieldLookup[field];
      return !!(fieldData && fieldData.properties && fieldData.properties.primary_key);
    }

    fieldDefaultValue(field) {
      let fieldData = this._fieldLookup[field];
      return !!(fieldData && fieldData.properties && fieldData.properties.array);
    }

    fieldList() {
      return this._fieldArray.map(function(v) { return v.name; });
    }

    fieldDefinitions() {
      return this._fieldArray.slice();
    }

    setError(key, message) {
      this._errors[key] = this._errors[key] || [];
      this._errors[key].push(message);
      return true;
    }

    clearError(key) {
      delete this._errors[key];
      return true;
    }

    save(db, callback) {

      let model = this;

      if (!(db instanceof Database)) {
        throw new Error('Must provide a valid Database to save to');
      }

      if(typeof callback !== 'function') {
        callback() = function() {};
      }

      if (model.hasErrors()) {
        setTimeout(callback.bind(model, model.getErrors(), model), 1);
        return;
      }

      let columns, query;

      if (!model.inStorage()) {

        columns = model.fieldList().filter(function(v) {
          return !model.isFieldPrimaryKey(v) && model.get(v) !== null;
        });

        query = db.adapter.generateInsertQuery(model.schema.table, columns);

      } else {

        columns = ['id'].concat(model.changedFields().filter(function(v) {
          return !model.isFieldPrimaryKey(v);
        }));

        query = db.adapter.generateUpdateQuery(model.schema.table, columns);

      }

      db.query(
        query,
        columns.map(function(v) {
          return db.adapter.sanitize(model.getFieldData(v).type, model.get(v));
        }),
        function(err, result) {

          if (err) {
            model.setError('_query', err.message);
          } else {
            result.rows.length && model.load(result.rows[0], true);
          }

          callback.call(model, model.errorObject(), model);

        }
      );

    }

    destroy(db, callback) {

      let model = this;

      if (!(db instanceof Database)) {
        throw new Error('Must provide a valid Database to save to');
      }

      if(typeof callback !== 'function') {
        callback() = function() {};
      }

      if (!model.inStorage()) {

        setTimeout(callback.bind(model, {'_query': 'Model has not been saved'}, model), 1);
        return;

      }

      let columns = model.fieldList().filter(function(v) {
        return model.isFieldPrimaryKey(v);
      });

      let query = db.adapter.generateDeleteQuery(model.schema.table, columns);

      db.query(
        query,
        columns.map(function(v) {
          return db.adapter.sanitize(model.getFieldData(v).type, model.get(v));
        }),
        function(err, result) {

          if (err) {
            model.setError('_query', err.message);
          } else {
            model._inStorage = false;
          }

          callback.call(model, model.errorObject(), model);

        }
      );

    }

  }

  Model.prototype.schema = {
    table: '',
    columns: []
  };

  Model.prototype.data = null;

  Model.prototype.externalInterface = [
    'id',
    'created_at'
  ];

  return Model;

})();
