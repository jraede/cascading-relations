var barClass, barSchema, bazClass, bazSchema, dot, fooClass, fooSchema, mongoose, relations, should;

mongoose = require('mongoose');

relations = require('../index');

should = require('should');

mongoose.connect('mongodb://localhost/mongoose_relations_test');

mongoose.set('debug', true);

dot = require('dotaccess');

barSchema = new mongoose.Schema({
  _foo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Foo',
    $through: '_bar'
  },
  _baz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Baz',
    $through: '_bar',
    $cascadeDelete: true
  },
  title: String,
  account: String
});

fooSchema = new mongoose.Schema({
  title: String,
  _bars: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bar',
      $through: '_foo'
    }
  ],
  _bar: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bar',
    $through: '_foo'
  },
  multi: {
    _bar: {
      type: mongoose.Schema.Types.ObjectId,
      $cascadeDelete: true,
      ref: 'Bar'
    },
    _bars: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Bar'
      }
    ]
  },
  account: String
});

bazSchema = new mongoose.Schema({
  title: String,
  _bar: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bar',
    $through: '_baz'
  }
});

fooSchema.plugin(relations);

barSchema.plugin(relations);

bazSchema.plugin(relations);

barClass = mongoose.model('Bar', barSchema);

fooClass = mongoose.model('Foo', fooSchema);

bazClass = mongoose.model('Baz', bazSchema);

describe('Testing', function() {
  this.timeout(10000);
  it('should populate on $related and leave IDs intact', function(done) {
    var bar;
    bar = new barClass({
      title: 'My Bar'
    });
    return bar.save(function(err, res) {
      var foo;
      foo = new fooClass({
        title: 'My Foo',
        multi: {
          _bars: [],
          _bar: res._id
        }
      });
      return foo.cascadeSave(function(err, res) {
        return mongoose.model('Foo').find().populate('multi._bar').populate('multi._bars').exec(function(err, res) {
          res[0].multi._bar.toString().should.equal(bar._id.toString());
          res[0]._related.multi._bar.title.should.equal('My Bar');
          return done();
        });
      });
    });
  });
  it('should cascade save relations', function(done) {
    var foo,
      _this = this;
    foo = new fooClass({
      title: 'My Foo',
      _related: {
        multi: {
          _bars: [
            {
              title: 'First Bar'
            }, {
              title: 'Second Bar'
            }
          ],
          _bar: {
            title: 'Third Bar'
          }
        },
        _bar: {
          title: 'Fourth Bar'
        },
        _bars: [
          {
            title: 'Fifth Bar'
          }, {
            title: 'Sixth Bar'
          }
        ]
      }
    });
    return foo.cascadeSave(function(err, res) {
      _this.foo = foo;
      res._related._bars[0].title.should.equal('Fifth Bar');
      res._related._bar.title.should.equal('Fourth Bar');
      res._related.multi._bars[1].title.should.equal('Second Bar');
      res._related.multi._bar.title.should.equal('Third Bar');
      res._related._bar._foo.toString().should.equal(res._id.toString());
      return done();
    });
  });
  it('should have set the $through value on a relation array', function(done) {
    this.foo._related._bars[0]._foo.toString().should.equal(this.foo._id.toString());
    return done();
  });
  it('should cascade delete when designated', function(done) {
    var deletedBarId, throughBarId;
    deletedBarId = this.foo.multi._bar;
    throughBarId = this.foo._bar;
    return this.foo.remove(function(err, res) {
      return setTimeout(function() {
        return barClass.findById(deletedBarId, function(err, res) {
          should.not.exist(res);
          return barClass.findById(throughBarId, function(err, res) {
            should.not.exist(res._foo);
            return done();
          });
        });
      }, 5000);
    });
  });
  it('should cascade save multiple levels deep', function(done) {
    var foo,
      _this = this;
    foo = new fooClass({
      title: 'My Foo',
      _related: {
        multi: {
          _bar: {
            title: 'My Bar',
            _related: {
              _baz: {
                title: 'My Baz'
              }
            }
          }
        }
      }
    });
    return foo.cascadeSave(function(err, result) {
      _this.foo = result;
      result._related.multi._bar._related._baz.title.should.equal('My Baz');
      result._related.multi._bar._related._baz._bar.toString().should.equal(result._related.multi._bar._id.toString());
      return done();
    });
  });
  it('should cascade delete multiple levels deep', function(done) {
    var deletedBazId;
    deletedBazId = this.foo._related.multi._bar._related._baz._id;
    return this.foo.remove(function(err, res) {
      return setTimeout(function() {
        return bazClass.findById(deletedBazId, function(err, res) {
          should.not.exist(res);
          return done();
        });
      }, 5000);
    });
  });
  it('should do normal save without cascading', function(done) {
    var foo;
    foo = new fooClass({
      title: 'My Foo',
      _related: {
        _bar: {
          title: 'My Bar'
        }
      }
    });
    return foo.save(function(err, result) {
      should.not.exist(foo._bar);
      return done();
    });
  });
  it('should do a save while limiting cascaded relations', function(done) {
    var foo,
      _this = this;
    foo = new fooClass({
      title: 'My Foo',
      account: 'asdf',
      _related: {
        _bar: {
          title: 'My Bar',
          _related: {
            _baz: {
              title: 'My Baz'
            }
          }
        },
        multi: {
          _bar: {
            title: 'My Bar 2',
            _related: {
              _baz: {
                title: 'My Baz 2'
              }
            }
          }
        }
      }
    });
    return foo.cascadeSave(function(err, res) {
      _this.foo = res;
      should.not.exist(res._related._bar._baz);
      return done();
    }, {
      limit: ['_bar', 'multi._bar', 'multi._bar._baz'],
      filter: function(doc) {
        doc.account = this.account;
        return doc;
      }
    });
  });
  it('should apply filter to cascading relations when saving', function(done) {
    this.foo._related._bar.account.should.equal('asdf');
    return done();
  });
  it('should still work with deep dot notation', function() {
    var obj;
    obj = {
      __t: "cornerstonesoftware__Unit",
      __v: 2,
      _id: "52cc929a90b078e563000024",
      bathrooms: 1,
      bedrooms: 1,
      core_account: "main-account",
      current_rent: 3000,
      last_rent_increase: "Wed Jan 08 2014 15:49:46 GMT-0800 (PST)",
      old_rent: 2000,
      street: "777 Via Hierba",
      unit_number: "1",
      status: "rented",
      rent_changes: [
        {
          rent: 1000,
          effective_date: "Tue Jan 07 2014 15:49:46 GMT-0800 (PST)",
          reason: "Unit added to system",
          _id: "52cc929a90b078e563000025",
          implemented: true,
          id: "52cc929a90b078e563000025"
        }, {
          reason: "Rent changed on tenant details",
          rent: 2000,
          effective_date: "Tue Jan 07 2014 15:49:46 GMT-0800 (PST)",
          _id: "52cc929a90b078e56300002f",
          implemented: true,
          id: "52cc929a90b078e56300002f"
        }, {
          effective_date: "Wed Jan 08 2014 15:49:46 GMT-0800 (PST)",
          rent: 3000,
          reason: "Test",
          _id: "52cc929a90b078e563000033",
          implemented: true,
          id: "52cc929a90b078e563000033"
        }
      ],
      tenants: {
        _current: {
          __t: "cornerstonesoftware__Tenant",
          _first_month_rent_journal: "52cc929a90b078e563000027",
          _deposit_journal: "52cc929a90b078e56300002a",
          _unit: "52cc929a90b078e563000024",
          _property: "52cc929a90b078e56300001b",
          ssn: "123-45-6789",
          move_in_date: "Tue Jan 07 2014 15:49:46 GMT-0800 (PST)",
          rent_due_date: 8,
          deposit: 500,
          rent: 2000,
          core_account: "main-account",
          _id: "52cc929a90b078e563000026",
          __v: 0,
          additional_tenants: [],
          notes: [],
          balance: -2500,
          record_deposit: true,
          deposit_paid: false,
          status: "current",
          contacts: [],
          name: {
            first: 'Foo',
            last: 'Bar'
          },
          expected_move_out: null,
          _related: void 0,
          id: "52cc929a90b078e563000026"
        },
        _former: []
      },
      rent_controlled: false,
      notes: [],
      _related: void 0,
      id: "52cc929a90b078e563000024"
    };
    dot.set(obj, 'tenants._former', [], true);
    return obj.tenants._current.name.first.should.equal('Foo');
  });
  it('should be accurate when you put with fewer relations (implicit delete)', function(done) {
    var foo,
      _this = this;
    foo = new fooClass({
      title: 'My Foo',
      _related: {
        _bars: [
          {
            title: 'First Bar'
          }, {
            title: 'Second Bar'
          }
        ]
      }
    });
    return foo.cascadeSave(function(err, res) {
      foo._bars.pop();
      foo._related._bars.pop();
      return foo.cascadeSave(function(err, res) {
        res._bars.length.should.equal(1);
        res._related._bars.length.should.equal(1);
        return done();
      });
    });
  });
  it('should rearrange when running populate on document rather than query', function(done) {
    var foo,
      _this = this;
    foo = new fooClass({
      title: 'My Foo',
      _related: {
        _bars: [
          {
            title: 'First Bar'
          }, {
            title: 'Second Bar'
          }
        ]
      }
    });
    return foo.cascadeSave(function(err, res) {
      return fooClass.findById(res._id, function(err, foo) {
        return foo.populate('_bars', function(err, foo) {
          should.exist(foo._related);
          should.exist(foo._related._bars);
          foo._related._bars.length.should.equal(2);
          foo._bars[0].toString().should.equal(foo._related._bars[0]._id.toString());
          return done();
        });
      });
    });
  });
  it('should handle doc populate with nested relations', function(done) {
    var foo,
      _this = this;
    foo = new fooClass({
      title: 'My Foo',
      _related: {
        multi: {
          _bar: {
            title: 'First Bar'
          }
        }
      }
    });
    return foo.cascadeSave(function(err, res) {
      return fooClass.findById(res._id, function(err, foo) {
        return foo.populate('multi._bar', function(err, foo) {
          should.exist(foo._related);
          should.exist(foo._related.multi);
          should.exist(foo._related.multi._bar);
          foo._related.multi._bar.title.should.equal('First Bar');
          console.log('FOO:', foo.toObject());
          foo._related.multi._bar._id.toString().should.equal(foo.multi._bar.toString());
          return done();
        });
      });
    });
  });
  it('should still work with mongoose populate on query, which automatically creates a new model instance when you push', function(done) {
    var myFoo;
    myFoo = new fooClass({
      title: 'Test Foo',
      _related: {
        _bars: [
          {
            title: 'Test Bar'
          }
        ]
      }
    });
    return myFoo.cascadeSave(function(err) {
      if (err) {
        return done(err);
      }
      myFoo._related._bars.length.should.equal(1);
      myFoo._bars.length.should.equal(1);
      return fooClass.findById(myFoo._id).populate('_bars').exec(function(err, foo) {
        foo._related._bars.push({
          title: 'Test Bar 2'
        });
        return foo.cascadeSave(function(err) {
          if (err) {
            return done(err);
          }
          foo._related._bars.length.should.equal(2);
          foo._bars.length.should.equal(2);
          should.not.exist(foo._bars[1]._id);
          should.exist(foo._related._bars[1]._id);
          return done();
        });
      });
    });
  });
  return it('should handle multiple calls of populate', function(done) {
    var myFoo;
    myFoo = new fooClass({
      title: 'Test Foo',
      _related: {
        _bars: [
          {
            title: 'Test Bar'
          }
        ],
        _bar: {
          title: 'Test bar 2'
        }
      }
    });
    return myFoo.cascadeSave(function(err) {
      if (err) {
        return done(err);
      }
      myFoo._related._bars.length.should.equal(1);
      myFoo._bars.length.should.equal(1);
      return fooClass.findById(myFoo._id).exec(function(err, foo) {
        return foo.populate('_bars', function(err) {
          return foo.populate('_bar', function(err) {
            foo._related._bars[0].title.should.equal('Test Bar');
            foo._related._bar.title.should.equal('Test bar 2');
            foo._bar.toString().should.equal(foo._related._bar._id.toString());
            return done();
          });
        });
      });
    });
  });
});
